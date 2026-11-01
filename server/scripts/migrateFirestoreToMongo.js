require("dotenv").config();

const { applicationDefault, cert, initializeApp } = require("firebase-admin/app");
const { DocumentReference, FieldPath, GeoPoint, Timestamp, getFirestore } = require("firebase-admin/firestore");
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const FirebaseDocument = require("../src/models/firebaseDocument");

const ROOT_COLLECTIONS = [
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
];
const PAGE_SIZE = 300;

function serializeFirestoreValue(value) {
    if (value instanceof Timestamp) {
        return {
            __firestoreType: "timestamp",
            seconds: value.seconds,
            nanoseconds: value.nanoseconds
        };
    }
    if (value instanceof DocumentReference) {
        return { __firestoreType: "reference", path: value.path };
    }
    if (value instanceof GeoPoint) {
        return {
            __firestoreType: "geopoint",
            latitude: value.latitude,
            longitude: value.longitude
        };
    }
    if (Buffer.isBuffer(value)) {
        return { __firestoreType: "bytes", base64: value.toString("base64") };
    }
    if (Array.isArray(value)) return value.map(serializeFirestoreValue);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, serializeFirestoreValue(item)])
        );
    }
    return value;
}

function createFirebaseApp() {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    if (projectId !== "govindkr-dev") {
        throw new Error("FIREBASE_PROJECT_ID must be govindkr-dev, the project used by the JEXOLYT website.");
    }
    let credential;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        let serviceAccount;
        try {
            serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        } catch {
            throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON.");
        }
        credential = cert(serviceAccount);
    } else {
        credential = applicationDefault();
    }
    return initializeApp({ credential, projectId }, "jexolyt-firestore-migration");
}

function makeDocumentOperation(snapshot, importedAt) {
    const path = snapshot.ref.path;
    const rootCollection = path.split("/")[0];
    return {
        updateOne: {
            filter: { sourcePath: path },
            update: {
                $set: {
                    rootCollection,
                    documentId: snapshot.id,
                    data: serializeFirestoreValue(snapshot.data()),
                    sourceCreatedAt: snapshot.createTime?.toDate() || null,
                    sourceUpdatedAt: snapshot.updateTime?.toDate() || null,
                    importedAt
                }
            },
            upsert: true
        }
    };
}

async function copyCollection(collectionRef, rootCollection, apply, totals) {
    const rootCountBefore = totals[rootCollection] || 0;
    let lastDocument = null;
    while (true) {
        let query = collectionRef
            .orderBy(FieldPath.documentId())
            .limit(PAGE_SIZE);
        if (lastDocument) query = query.startAfter(lastDocument);
        const page = await query.get();
        if (page.empty) break;

        const importedAt = new Date();
        const operations = page.docs.map(snapshot => {
            totals[rootCollection] = (totals[rootCollection] || 0) + 1;
            return makeDocumentOperation(snapshot, importedAt);
        });

        if (apply && operations.length) {
            await FirebaseDocument.bulkWrite(operations, { ordered: false });
        }

        for (const snapshot of page.docs) {
            const subcollections = await snapshot.ref.listCollections();
            for (const subcollection of subcollections) {
                await copyCollection(subcollection, rootCollection, apply, totals);
            }
        }
        lastDocument = page.docs[page.docs.length - 1];
    }
    return (totals[rootCollection] || 0) - rootCountBefore;
}

async function migrate({ apply }) {
    const app = createFirebaseApp();
    const firestore = getFirestore(app);
    const totals = {};
    const rootSummaries = [];
    try {
        for (const rootCollection of ROOT_COLLECTIONS) {
            const count = await copyCollection(
                firestore.collection(rootCollection),
                rootCollection,
                apply,
                totals
            );
            rootSummaries.push({ rootCollection, documents: count });
        }
        if (apply) {
            for (const [rootCollection, expectedCount] of Object.entries(totals)) {
                const actualCount = await FirebaseDocument.countDocuments({ rootCollection });
                if (actualCount !== expectedCount) {
                    throw new Error(
                        `Verification failed for ${rootCollection}: read ${expectedCount}, found ${actualCount} in MongoDB.`
                    );
                }
            }
        }
        return { rootSummaries, total: Object.values(totals).reduce((sum, count) => sum + count, 0) };
    } finally {
        await app.delete();
    }
}

async function main() {
    const apply = process.argv.includes("--apply");
    if (!apply && !process.argv.includes("--dry-run")) {
        throw new Error("No records were written. Run with --dry-run to inspect counts or --apply to copy.");
    }

    await connectDB();
    try {
        const result = await migrate({ apply });
        console.log(`${apply ? "Migration copy" : "Dry run"} completed.`);
        for (const summary of result.rootSummaries) {
            console.log(`${summary.rootCollection}: ${summary.documents}`);
        }
        console.log(`Total Firestore documents including subcollections: ${result.total}`);
        if (apply) console.log("MongoDB document counts verified. Firestore source data was not modified.");
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error("Firestore migration failed:", error.message);
        process.exitCode = 1;
    });
}

module.exports = {
    ROOT_COLLECTIONS,
    serializeFirestoreValue,
    makeDocumentOperation,
    copyCollection
};
