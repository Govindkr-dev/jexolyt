const test = require("node:test");
const assert = require("node:assert/strict");
const { validateFirestoreMigrationRequest } = require("../src/routes/adminRoutes");

test("Firestore migration is restricted to the Super Admin", () => {
    const error = validateFirestoreMigrationRequest(
        { role: "admin" },
        { mode: "dry-run" }
    );
    assert.deepEqual(error, {
        status: 403,
        message: "Only the Super Admin can migrate Firestore data."
    });
});

test("Firestore migration accepts a read-only dry run without copy confirmation", () => {
    assert.equal(
        validateFirestoreMigrationRequest(
            { role: "super_admin" },
            { mode: "dry-run" }
        ),
        null
    );
});

test("Firestore copy requires exact confirmation and a write pause", () => {
    const user = { role: "super_admin" };
    assert.equal(validateFirestoreMigrationRequest(user, { mode: "copy" }).status, 400);
    assert.equal(
        validateFirestoreMigrationRequest(user, {
            mode: "copy",
            confirm: "COPY_FIRESTORE_TO_MONGODB",
            writesPaused: false
        }).status,
        400
    );
    assert.equal(
        validateFirestoreMigrationRequest(user, {
            mode: "copy",
            confirm: "COPY_FIRESTORE_TO_MONGODB",
            writesPaused: true
        }),
        null
    );
});
