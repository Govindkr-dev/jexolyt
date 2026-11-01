const test = require("node:test");
const assert = require("node:assert/strict");
const { CHAT_ACCESS_TTL_MS, buildAdminChatIdentity } = require("../src/controllers/adminChatController");

test("admin chat identity has a stable Firebase uid and a short-lived access claim", () => {
    const now = 1_800_000_000_000;
    const identity = buildAdminChatIdentity({
        _id: { toString: () => "507f1f77bcf86cd799439011" },
        fullName: "Jexolyt Admin",
        email: "admin@example.com",
        role: "admin"
    }, now);

    assert.equal(identity.uid, "jexolyt_admin_507f1f77bcf86cd799439011");
    assert.equal(identity.claims.jexolytAdmin, true);
    assert.equal(identity.claims.adminRole, "admin");
    assert.equal(identity.claims.adminEmail, "admin@example.com");
    assert.equal(identity.claims.chatExpiresAt, now + CHAT_ACCESS_TTL_MS);
});

test("admin chat identity rejects missing or malformed admin ids", () => {
    assert.throws(() => buildAdminChatIdentity({}), /valid admin account/i);
    assert.throws(() => buildAdminChatIdentity({
        _id: "not-an-object-id",
        fullName: "Admin",
        email: "admin@example.com",
        role: "admin"
    }), /valid admin account/i);
});
