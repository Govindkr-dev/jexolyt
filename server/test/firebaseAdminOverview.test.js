const test = require("node:test");
const assert = require("node:assert/strict");
const {
    currentBusinessDate,
    loadFirebaseAdminOverview,
    createFirebaseAdminOverviewHandler
} = require("../src/controllers/firebaseAdminOverviewController");

function createFirestore(counts) {
    return {
        collection(name) {
            const filters = [];
            const query = {
                where(field, operator, value) {
                    filters.push([field, operator, value]);
                    return query;
                },
                count() {
                    return {
                        async get() {
                            const key = `${name}:${JSON.stringify(filters)}`;
                            return { data: () => ({ count: counts[key] ?? 0 }) };
                        }
                    };
                }
            };
            return query;
        }
    };
}

test("business date uses the JEXOLYT India timezone", () => {
    assert.equal(currentBusinessDate(new Date("2025-01-01T20:00:00.000Z")), "2025-01-02");
});

test("Firebase overview returns aggregate-only workforce and workflow metrics", async () => {
    const db = createFirestore({
        "team:[]": 8,
        'team:[["active","==",false]]': 2,
        "members:[]": 12,
        'members:[["accountStatus","==","approved"]]': 7,
        "clients:[]": 5,
        'staffProjects:[["status","in",["in_progress","active"]]]': 3,
        "staffTasks:[]": 9,
        'staffTasks:[["status","in",["new","assigned","in_progress","under_review","revision_required"]]]': 6,
        'staffTasks:[["status","==","under_review"]]': 2,
        'staffTasks:[["status","==","completed"]]': 3,
        'attendance:[["date","==","2025-02-14"]]': 4,
        'leaveRequests:[["status","==","pending"]]': 1,
        'attendanceCorrections:[["status","==","pending"]]': 2
    });

    assert.deepEqual(await loadFirebaseAdminOverview(db, new Date("2025-02-14T12:00:00.000Z")), {
        staff: { total: 8, active: 6 },
        networkMembers: { total: 12, approved: 7 },
        clients: 5,
        activeProjects: 3,
        tasks: { total: 9, pending: 6, awaitingReview: 2, completed: 3 },
        attendance: { presentToday: 4, date: "2025-02-14" },
        pendingApprovals: 5,
        leave: { pending: 1 }
    });
});

test("Firebase overview rejects non-Super Admins without connecting to Firestore", async () => {
    let firestoreRequested = false;
    let statusCode;
    let responseBody;
    const handler = createFirebaseAdminOverviewHandler(() => {
        firestoreRequested = true;
        throw new Error("Firestore must not be reached.");
    });

    await handler(
        { user: { role: "admin" } },
        {
            status(code) {
                statusCode = code;
                return this;
            },
            json(body) {
                responseBody = body;
                return this;
            }
        },
        error => { throw error; }
    );

    assert.equal(statusCode, 403);
    assert.equal(responseBody.success, false);
    assert.equal(firestoreRequested, false);
});

test("Super Admin overview responds without caching and returns only summary metrics", async () => {
    const previousProjectId = process.env.FIREBASE_PROJECT_ID;
    process.env.FIREBASE_PROJECT_ID = "govindkr-dev";
    let responseBody;
    let cacheControl;
    let statusCode;
    const handler = createFirebaseAdminOverviewHandler(() => createFirestore({}));

    try {
        await handler(
            { user: { role: "super_admin" } },
            {
                set(name, value) {
                    if (name === "Cache-Control") cacheControl = value;
                },
                status(code) {
                    statusCode = code;
                    return this;
                },
                json(body) {
                    responseBody = body;
                    return this;
                }
            },
            error => { throw error; }
        );
    } finally {
        if (previousProjectId === undefined) delete process.env.FIREBASE_PROJECT_ID;
        else process.env.FIREBASE_PROJECT_ID = previousProjectId;
    }

    assert.equal(statusCode, 200);
    assert.equal(cacheControl, "no-store");
    assert.equal(responseBody.success, true);
    assert.deepEqual(Object.keys(responseBody), ["success", "summary"]);
    assert.equal(responseBody.summary.staff.total, 0);
});
