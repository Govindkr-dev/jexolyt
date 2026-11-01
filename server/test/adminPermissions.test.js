const test = require("node:test");
const assert = require("node:assert/strict");
const {
    hasPermission,
    cleanPermissions,
    validateRecordInput
} = require("../src/utils/adminPermissions");

test("Super Admin receives supported module actions only", () => {
    assert.equal(hasPermission({ role: "super_admin" }, "finance", "delete"), true);
    assert.equal(hasPermission({ role: "super_admin" }, "not-a-module", "view"), false);
    assert.equal(hasPermission({ role: "super_admin" }, "finance", "owner"), false);
});

test("Admin access requires an explicitly enabled permission", () => {
    const user = { role: "admin", permissions: { projects: { view: true, delete: false } } };
    assert.equal(hasPermission(user, "projects", "view"), true);
    assert.equal(hasPermission(user, "projects", "delete"), false);
    assert.equal(hasPermission(user, "finance", "view"), false);
});

test("permission updates reject unsupported modules and non-boolean values", () => {
    assert.deepEqual(cleanPermissions({ projects: { view: true, delete: false } }), {
        projects: { view: true, delete: false }
    });
    assert.throws(() => cleanPermissions({ unknown: { view: true } }), /unsupported module/i);
    assert.throws(() => cleanPermissions({ projects: { view: "true" } }), /boolean/i);
});

test("record validation normalizes titles and applies module status defaults", () => {
    assert.deepEqual(validateRecordInput({ title: "  Website build  " }, "projects"), {
        title: "Website build",
        status: "planning",
        data: { metadata: {} }
    });
});

test("finance records require non-negative amounts and valid statuses", () => {
    assert.throws(() => validateRecordInput({ title: "Invoice" }, "finance"), /require an amount/i);
    assert.throws(() => validateRecordInput({ title: "Invoice", amount: -1, transactionType: "income" }, "finance"), /non-negative/i);
    assert.throws(() => validateRecordInput({ title: "Invoice", amount: 10, transactionType: "income", status: "paid-ish" }, "finance"), /supported status/i);
});

test("admin record metadata rejects credentials and unsafe URLs", () => {
    assert.throws(() => validateRecordInput({
        title: "Email integration",
        metadata: { apiKey: "do-not-store" }
    }, "integrations"), /secrets and credentials/i);
    assert.throws(() => validateRecordInput({ title: "Unsafe link", url: "javascript:alert(1)" }, "projects"), /HTTP and HTTPS/i);
    assert.equal(validateRecordInput({ title: "Anchor", url: "#contact" }, "projects").data.url, "#contact");
});

test("homepage CMS records accept only safe button destinations", () => {
    assert.throws(() => validateRecordInput({
        title: "Homepage",
        status: "published",
        metadata: { key: "homepage", buttonUrl: "javascript:alert(1)" }
    }, "website"), /same-site path or HTTP\(S\)/i);
    assert.equal(validateRecordInput({
        title: "Homepage",
        status: "published",
        metadata: { key: "homepage", buttonUrl: "#contact" }
    }, "website").status, "published");
});
