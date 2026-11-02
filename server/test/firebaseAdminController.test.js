const test = require("node:test");
const assert = require("node:assert/strict");
const {
    COLLECTIONS,
    createFirebaseRecord,
    sendStaffInvitationEmail,
    validateCreateInput,
    validateUpdateInput,
    createFirebaseAdminHandlers
} = require("../src/controllers/firebaseAdminController");

const actor = { email: "owner@example.com", fullName: "JEXOLYT Owner" };

test("Firebase admin collections map only supported workspace sections", () => {
    assert.equal(COLLECTIONS.tasks, "staffTasks");
    assert.equal(COLLECTIONS.leave, "leaveRequests");
    assert.equal(COLLECTIONS.members, "members");
    assert.equal(COLLECTIONS.unknown, undefined);
});

test("staff invitations are normalized and begin as employee invitations", () => {
    const invitation = validateCreateInput("invitations", {
        email: "STAFF@example.com",
        name: "Team member",
        department: "Technology",
        designation: "Developer",
        accessRole: "employee"
    }, actor);
    assert.equal(invitation.id, "staff@example.com");
    assert.equal(invitation.data.email, "staff@example.com");
    assert.equal(invitation.data.accessRole, "employee");
    assert.equal(invitation.data.status, "pending");
    assert.equal(invitation.data.invitedByEmail, actor.email);
});

test("staff invitations send a verified-email login link through the configured email provider", async () => {
    let request;
    await sendStaffInvitationEmail({
        email: "staff@example.com",
        name: "Team member",
        department: "Technology",
        designation: "Developer"
    }, {
        env: {
            RESEND_API_KEY: "test-key",
            RESEND_FROM_EMAIL: "JEXOLYT <team@example.com>"
        },
        fetchImpl: async (url, options) => {
            request = { url, options };
            return { ok: true };
        }
    });

    assert.equal(request.url, "https://api.resend.com/emails");
    const body = JSON.parse(request.options.body);
    assert.deepEqual(body.to, ["staff@example.com"]);
    assert.match(body.text, /https:\/\/jexolyt\.web\.app\/pages\/login\.html/);
    assert.equal(request.options.headers.Authorization, "Bearer test-key");
});

test("staff invitation email failures are explicit and leave a retryable invitation", async () => {
    await assert.rejects(sendStaffInvitationEmail({
        email: "staff@example.com",
        name: "Team member",
        department: "Technology",
        designation: "Developer"
    }, { env: {} }), /email service is not configured/i);

    const stored = {};
    const reference = {
        id: "staff@example.com",
        async get() { return { exists: Boolean(stored.email), id: this.id, data: () => stored }; },
        async create(data) { Object.assign(stored, data); },
        async update(data) { Object.assign(stored, data); }
    };
    const db = { collection: () => ({ doc: () => reference }) };
    const record = await createFirebaseRecord(db, "invitations", {
        email: "staff@example.com",
        name: "Team member",
        department: "Technology",
        designation: "Developer"
    }, actor, async () => { throw new Error("Email provider unavailable."); });

    assert.equal(record.emailStatus, "failed");
    assert.equal(stored.status, "pending");
});

test("Firebase creation rejects unsupported roles and malformed assignments", () => {
    assert.throws(() => validateCreateInput("invitations", {
        email: "staff@example.com",
        name: "Team member",
        department: "Technology",
        designation: "Developer",
        accessRole: "super_admin"
    }, actor), /employee role/i);
    assert.throws(() => validateCreateInput("tasks", {
        title: "Build dashboard",
        description: "",
        department: "Unknown",
        assigneeEmail: "staff@example.com",
        startDate: "2025-03-01",
        deadline: "2025-03-10"
    }, actor), /supported department/i);
    assert.throws(() => validateCreateInput("resources", {
        title: "Docs",
        department: "all",
        url: "javascript:alert(1)"
    }, actor), /valid HTTPS/i);
    assert.throws(() => validateCreateInput("tasks", {
        title: "Build dashboard",
        department: "Technology",
        assigneeEmail: "staff@example.com",
        startDate: "2025-02-29",
        deadline: "2025-03-10"
    }, actor), /valid YYYY-MM-DD/i);
});

test("project and announcement inputs enforce supported departments and bounds", () => {
    assert.throws(() => validateCreateInput("projects", {
        title: "Project",
        department: "Technology",
        memberEmails: [],
        progress: 101
    }, actor), /between 1 and 50/i);
    const announcement = validateCreateInput("announcements", {
        title: "Company update",
        message: "A short update",
        department: "all"
    }, actor);
    assert.equal(announcement.data.department, "all");
    assert.equal(announcement.data.createdByEmail, actor.email);
    assert.throws(() => validateCreateInput("projects", {
        title: "Project",
        department: "Technology",
        memberEmails: ["staff@example.com"],
        deadline: "2025-02-30"
    }, actor), /valid YYYY-MM-DD/i);
});

test("staff updates cannot escalate to Super Admin or modify unapproved fields", () => {
    assert.throws(() => validateUpdateInput("staff", { accessRole: "super_admin" }), /supported staff access role/i);
    assert.throws(() => validateUpdateInput("staff", { email: "attacker@example.com" }), /supported staff profile fields/i);
    assert.equal(validateUpdateInput("staff", { active: false }).active, false);
});

test("task reviews and HR approvals accept only known decisions", () => {
    assert.equal(validateUpdateInput("tasks", {
        action: "revision",
        actorEmail: actor.email,
        feedback: "Please add the requested details."
    }).status, "revision_required");
    assert.throws(() => validateUpdateInput("tasks", {
        action: "cancel",
        actorEmail: actor.email
    }), /approve, reject, or request revision/i);
    assert.equal(validateUpdateInput("leave", {
        status: "approved",
        actorEmail: actor.email
    }).status, "approved");
    assert.throws(() => validateUpdateInput("corrections", {
        status: "pending",
        actorEmail: actor.email
    }), /approved or rejected/i);
});

test("completing a project also completes its progress", () => {
    assert.equal(validateUpdateInput("projects", { status: "completed" }).progress, 100);
    assert.throws(() => validateUpdateInput("projects", {
        status: "completed",
        progress: 90
    }), /100% progress/i);
});

test("Firebase record routes reject non-Super Admins before accessing Firebase", async () => {
    const previousProjectId = process.env.FIREBASE_PROJECT_ID;
    process.env.FIREBASE_PROJECT_ID = "govindkr-dev";
    let firestoreRequested = false;
    let statusCode;
    let responseBody;
    const handlers = createFirebaseAdminHandlers(() => {
        firestoreRequested = true;
        throw new Error("Firestore must not be accessed.");
    }, async () => {});

    try {
        await handlers.list(
            { user: { role: "admin" }, params: { module: "tasks" }, query: {} },
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
    } finally {
        if (previousProjectId === undefined) delete process.env.FIREBASE_PROJECT_ID;
        else process.env.FIREBASE_PROJECT_ID = previousProjectId;
    }

    assert.equal(statusCode, 403);
    assert.equal(responseBody.success, false);
    assert.equal(firestoreRequested, false);
});

test("staff profile updates do not pass review-only actor fields into profile validation", async () => {
    const previousProjectId = process.env.FIREBASE_PROJECT_ID;
    process.env.FIREBASE_PROJECT_ID = "govindkr-dev";
    const staff = { email: "staff@example.com", name: "Old name", department: "Technology", active: true };
    const reference = {
        id: "staff@example.com",
        async get() {
            return { exists: true, id: this.id, data: () => staff };
        }
    };
    const db = {
        collection(name) {
            if (name === "team") return { doc: () => reference };
            if (name === "staffDirectory") return { doc: () => ({ get: async () => ({ exists: false }) }) };
            throw new Error(`Unexpected collection: ${name}`);
        },
        batch() {
            return {
                update(target, update) { Object.assign(staff, update); },
                async commit() {}
            };
        }
    };
    const handlers = createFirebaseAdminHandlers(() => db, async () => {});
    let responseBody;

    try {
        await handlers.update({
            user: { role: "super_admin", email: actor.email, fullName: actor.fullName },
            params: { module: "staff", id: "staff@example.com" },
            body: { name: "Updated name" }
        }, {
            set() {},
            json(body) { responseBody = body; }
        }, error => { throw error; });
    } finally {
        if (previousProjectId === undefined) delete process.env.FIREBASE_PROJECT_ID;
        else process.env.FIREBASE_PROJECT_ID = previousProjectId;
    }

    assert.equal(responseBody.success, true);
    assert.equal(responseBody.record.name, "Updated name");
});
