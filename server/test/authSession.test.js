const test = require("node:test");
const assert = require("node:assert/strict");
const cookie = require("cookie");
const { cookieOptions, SESSION_COOKIE, SESSION_MAX_AGE } = require("../src/controllers/authController");

test("production sessions use secure partitioned cookies for the Firebase frontend", () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
        const serialized = cookie.serialize(SESSION_COOKIE, "session-token", cookieOptions());
        assert.match(serialized, /HttpOnly/i);
        assert.match(serialized, /Secure/i);
        assert.match(serialized, /SameSite=None/i);
        assert.match(serialized, /Partitioned/i);
        assert.match(serialized, new RegExp(`Max-Age=${SESSION_MAX_AGE / 1000}`));
    } finally {
        if (previousEnvironment === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousEnvironment;
    }
});

test("remembered production sessions persist for 30 days", () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
        const serialized = cookie.serialize(SESSION_COOKIE, "session-token", cookieOptions(true));
        assert.match(serialized, /HttpOnly/i);
        assert.match(serialized, /Secure/i);
        assert.match(serialized, /Partitioned/i);
        assert.match(serialized, /Max-Age=2592000/i);
    } finally {
        if (previousEnvironment === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousEnvironment;
    }
});
