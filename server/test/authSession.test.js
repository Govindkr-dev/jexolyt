const test = require("node:test");
const assert = require("node:assert/strict");
const cookie = require("cookie");
const jwt = require("jsonwebtoken");
const User = require("../src/models/user");
const AdminSession = require("../src/models/adminSession");
const {
    accessToken,
    refresh,
    cookieOptions,
    refreshCookieOptions,
    SESSION_COOKIE,
    REFRESH_COOKIE,
    SESSION_MAX_AGE,
    ACCESS_COOKIE_MAX_AGE,
    REMEMBERED_SESSION_MAX_AGE,
    hashRefreshToken
} = require("../src/controllers/authController");

test("production sessions use secure partitioned cookies for the Firebase frontend", () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
        const serialized = cookie.serialize(SESSION_COOKIE, "session-token", cookieOptions());
        assert.match(serialized, /HttpOnly/i);
        assert.match(serialized, /Secure/i);
        assert.match(serialized, /SameSite=None/i);
        assert.match(serialized, /Partitioned/i);
        assert.match(serialized, new RegExp(`Max-Age=${ACCESS_COOKIE_MAX_AGE / 1000}`));
    } finally {
        if (previousEnvironment === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousEnvironment;
    }
});

test("access cookies stay short-lived while refresh cookies retain the selected session duration", () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
        const access = cookie.serialize(SESSION_COOKIE, "access-token", cookieOptions());
        const remembered = cookie.serialize(REFRESH_COOKIE, "refresh-token", refreshCookieOptions(REMEMBERED_SESSION_MAX_AGE));
        const standard = cookie.serialize(REFRESH_COOKIE, "refresh-token", refreshCookieOptions(SESSION_MAX_AGE));
        assert.match(access, /Max-Age=900/i);
        assert.match(remembered, /HttpOnly/i);
        assert.match(remembered, /Secure/i);
        assert.match(remembered, /SameSite=None/i);
        assert.match(remembered, /Partitioned/i);
        assert.match(remembered, /Max-Age=2592000/i);
        assert.match(remembered, /Path=\/api\/auth/i);
        assert.match(standard, /Max-Age=28800/i);
    } finally {
        if (previousEnvironment === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousEnvironment;
    }
});

test("refresh tokens are stored as non-reversible SHA-256 digests", () => {
    const first = hashRefreshToken("random-secret");
    assert.equal(first, hashRefreshToken("random-secret"));
    assert.notEqual(first, "random-secret");
    assert.match(first, /^[a-f0-9]{64}$/);
});

test("access tokens are bound to a revocable session and expire after 15 minutes", () => {
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-hs256";

    try {
        const token = accessToken("user-id", "session-id");
        const decoded = jwt.verify(token, process.env.JWT_SECRET, {
            issuer: "jexolyt-admin",
            audience: "jexolyt-admin-panel",
            algorithms: ["HS256"]
        });
        assert.equal(decoded.id, "user-id");
        assert.equal(decoded.sid, "session-id");
        assert.equal(decoded.exp - decoded.iat, 900);
    } finally {
        if (previousSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = previousSecret;
    }
});

test("refresh-session records have a TTL index and keep token hashes private", () => {
    const indexes = AdminSession.schema.indexes();
    assert.ok(indexes.some(([keys, options]) => keys.expiresAt === 1 && options.expireAfterSeconds === 0));
    assert.equal(AdminSession.schema.path("refreshTokenHash").options.select, false);
});

test("refresh rotates the token while preserving the original session expiry", async () => {
    const previousEnvironment = process.env.NODE_ENV;
    const previousSecret = process.env.JWT_SECRET;
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-hs256";
    const originalMethods = {
        findOne: AdminSession.findOne,
        findOneAndUpdate: AdminSession.findOneAndUpdate,
        create: AdminSession.create,
        updateOne: AdminSession.updateOne,
        findById: User.findById
    };
    const expiry = new Date(Date.now() + 60 * 60 * 1000);
    const oldSession = {
        _id: "old-session",
        userId: "user-id",
        familyId: "session-family",
        expiresAt: expiry,
        revokedAt: null
    };
    let createdSession;
    let updatedSession;

    AdminSession.findOne = async () => oldSession;
    AdminSession.findOneAndUpdate = async () => oldSession;
    AdminSession.create = async value => {
        createdSession = value;
        return { _id: "new-session" };
    };
    AdminSession.updateOne = async (...args) => {
        updatedSession = args;
    };
    User.findById = async () => ({
        _id: "user-id",
        fullName: "Admin",
        email: "admin@example.com",
        role: "super_admin",
        status: "active",
        permissions: {}
    });

    const response = {
        cookies: {},
        status(code) {
            this.statusCode = code;
            return this;
        },
        cookie(name, value, options) {
            this.cookies[name] = { value, options };
        },
        json(body) {
            this.body = body;
            return this;
        },
        clearCookie(name) {
            this.clearedCookie = name;
        }
    };

    try {
        await refresh({ cookies: { [REFRESH_COOKIE]: "old-refresh-token" } }, response);
        assert.equal(response.statusCode, 200);
        assert.equal(createdSession.userId, "user-id");
        assert.equal(createdSession.familyId, "session-family");
        assert.equal(createdSession.expiresAt, expiry);
        assert.equal(updatedSession[1].$set.replacedBy, "new-session");
        assert.match(response.cookies[SESSION_COOKIE].value, /^.+\..+\..+$/);
        assert.notEqual(response.cookies[REFRESH_COOKIE].value, "old-refresh-token");
        assert.equal(response.cookies[REFRESH_COOKIE].options.httpOnly, true);
        assert.equal(response.cookies[REFRESH_COOKIE].options.secure, true);
        assert.equal(response.cookies[REFRESH_COOKIE].options.sameSite, "none");
        assert.equal(response.cookies[REFRESH_COOKIE].options.path, "/api/auth");
    } finally {
        AdminSession.findOne = originalMethods.findOne;
        AdminSession.findOneAndUpdate = originalMethods.findOneAndUpdate;
        AdminSession.create = originalMethods.create;
        AdminSession.updateOne = originalMethods.updateOne;
        User.findById = originalMethods.findById;
        if (previousEnvironment === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousEnvironment;
        if (previousSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = previousSecret;
    }
});
