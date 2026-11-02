const test = require("node:test");
const assert = require("node:assert/strict");
const {
    getFirebaseProjectId,
    parseServiceAccountJson
} = require("../src/services/firebaseAdminApp");

test("Firebase Admin uses the JEXOLYT project when its environment variable is omitted", () => {
    assert.equal(getFirebaseProjectId(""), "govindkr-dev");
    assert.equal(getFirebaseProjectId(undefined), "govindkr-dev");
});

test("Firebase Admin trims and validates an explicitly configured project ID", () => {
    assert.equal(getFirebaseProjectId(" govindkr-dev "), "govindkr-dev");
    assert.throws(() => getFirebaseProjectId("another-project"), /FIREBASE_PROJECT_ID must be govindkr-dev/i);
});

test("Firebase Admin normalizes escaped and actual private-key newlines", () => {
    const escaped = parseServiceAccountJson(JSON.stringify({
        private_key: "  -----BEGIN PRIVATE KEY-----\\nkey-data\\n-----END PRIVATE KEY-----  "
    }));
    const actual = parseServiceAccountJson(JSON.stringify({
        private_key: "-----BEGIN PRIVATE KEY-----\r\nkey-data\r\n-----END PRIVATE KEY-----"
    }));

    assert.equal(escaped.private_key, "-----BEGIN PRIVATE KEY-----\nkey-data\n-----END PRIVATE KEY-----");
    assert.equal(actual.private_key, "-----BEGIN PRIVATE KEY-----\nkey-data\n-----END PRIVATE KEY-----");
});
