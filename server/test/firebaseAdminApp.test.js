const test = require("node:test");
const assert = require("node:assert/strict");
const { getFirebaseProjectId } = require("../src/services/firebaseAdminApp");

test("Firebase Admin uses the JEXOLYT project when its environment variable is omitted", () => {
    assert.equal(getFirebaseProjectId(""), "govindkr-dev");
    assert.equal(getFirebaseProjectId(undefined), "govindkr-dev");
});

test("Firebase Admin trims and validates an explicitly configured project ID", () => {
    assert.equal(getFirebaseProjectId(" govindkr-dev "), "govindkr-dev");
    assert.throws(() => getFirebaseProjectId("another-project"), /FIREBASE_PROJECT_ID must be govindkr-dev/i);
});
