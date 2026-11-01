const test = require("node:test");
const assert = require("node:assert/strict");
const { initializeApp } = require("firebase-admin/app");
const { GeoPoint, getFirestore, Timestamp } = require("firebase-admin/firestore");
const {
    ROOT_COLLECTIONS,
    makeDocumentOperation,
    serializeFirestoreValue
} = require("../scripts/migrateFirestoreToMongo");

test("migration inventories the legacy Firestore collections", () => {
    assert.deepEqual(ROOT_COLLECTIONS, [
        "adminActivity",
        "applications",
        "attendance",
        "categories",
        "chats",
        "contacts",
        "members",
        "notifications",
        "publicProfiles",
        "team",
        "users",
        "worklogs"
    ]);
});

test("Firestore special values serialize without losing their type or payload", () => {
    const app = initializeApp({ projectId: "migration-test" }, "migration-serialization-test");
    const timestamp = new Timestamp(1_700_000_000, 123_000_000);
    const reference = getFirestore(app).doc("members/member-1/projects/project-1");
    const geopoint = new GeoPoint(37.4219999, -122.0840575);
    try {
        const serialized = serializeFirestoreValue({
            createdAt: timestamp,
            project: reference,
            location: geopoint,
            tags: ["portfolio"]
        });

        assert.deepEqual(serialized.createdAt, {
            __firestoreType: "timestamp",
            seconds: 1_700_000_000,
            nanoseconds: 123_000_000
        });
        assert.deepEqual(serialized.project, {
            __firestoreType: "reference",
            path: "members/member-1/projects/project-1"
        });
        assert.deepEqual(serialized.location, {
            __firestoreType: "geopoint",
            latitude: 37.4219999,
            longitude: -122.0840575
        });
        assert.deepEqual(serialized.tags, ["portfolio"]);
    } finally {
        app.delete();
    }
});

test("migration maps Firestore document IDs and paths into stable Mongo keys", () => {
    const snapshot = {
        id: "project-1",
        ref: {
            path: "members/member-1/projects/project-1"
        },
        data: () => ({ title: "Portfolio project" }),
        createTime: Timestamp.fromDate(new Date("2025-01-01T00:00:00.000Z")),
        updateTime: Timestamp.fromDate(new Date("2025-02-01T00:00:00.000Z"))
    };
    const operation = makeDocumentOperation(snapshot, new Date("2025-03-01T00:00:00.000Z"));

    assert.equal(operation.updateOne.filter.sourcePath, "members/member-1/projects/project-1");
    assert.equal(operation.updateOne.update.$set.rootCollection, "members");
    assert.equal(operation.updateOne.update.$set.documentId, "project-1");
    assert.equal(operation.updateOne.update.$set.data.title, "Portfolio project");
    assert.equal(operation.updateOne.upsert, true);
});
