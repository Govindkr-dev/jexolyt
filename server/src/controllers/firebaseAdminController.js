const { FieldValue } = require("firebase-admin/firestore");

const DEPARTMENTS = [
    "Technology",
    "Video Editing & Design",
    "Digital Marketing",
    "Operations",
    "Website Maintenance"
];
const ACCESS_ROLES = ["employee", "team_leader", "department_head", "admin"];
const PROJECT_STATUSES = ["planning", "in_progress", "completed", "on_hold"];
const COLLECTIONS = {
    staff: "team",
    members: "members",
    invitations: "staffInvitations",
    tasks: "staffTasks",
    projects: "staffProjects",
    attendance: "attendance",
    leave: "leaveRequests",
    corrections: "attendanceCorrections",
    worklogs: "worklogs",
    announcements: "teamAnnouncements",
    resources: "teamResources",
    messages: "teamMessages",
    clients: "clients",
    supportTickets: "supportTickets"
};
const SORT_FIELDS = {
    staff: "addedAt",
    members: "createdAt",
    invitations: "createdAt",
    tasks: "createdAt",
    projects: "createdAt",
    attendance: "date",
    leave: "createdAt",
    corrections: "createdAt",
    worklogs: "createdAt",
    announcements: "createdAt",
    resources: "createdAt",
    messages: "createdAt",
    clients: "createdAt",
    supportTickets: "createdAt"
};
const CREATE_MODULES = new Set(["invitations", "tasks", "projects", "announcements", "resources"]);
const EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const STAFF_LOGIN_URL = "https://jexolyt.web.app/pages/login.html";

function validationError(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
}

function requireText(value, label, maxLength, { optional = false } = {}) {
    if (optional && (value === undefined || value === "")) return "";
    if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
        throw validationError(`${label} must contain 1–${maxLength} characters.`);
    }
    return value.trim();
}

function requireEmail(value, label = "Email") {
    const email = requireText(value, label, 254).toLowerCase();
    if (!EMAIL_PATTERN.test(email)) throw validationError(`${label} must be a valid email address.`);
    return email;
}

function requireDepartment(value) {
    if (!DEPARTMENTS.includes(value)) throw validationError("Choose a supported department.");
    return value;
}

function rejectUnknownFields(body, allowed) {
    if (Object.keys(body).some(key => !allowed.includes(key))) {
        throw validationError("The request contains unsupported fields.");
    }
}

function requireDate(value, label) {
    const date = requireText(value, label, 10);
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
        throw validationError(`${label} must be a valid YYYY-MM-DD date.`);
    }
    return date;
}

function serializeValue(value) {
    if (value === null || value === undefined) return value;
    if (typeof value.toDate === "function") return value.toDate().toISOString();
    if (Array.isArray(value)) return value.map(serializeValue);
    if (typeof value === "object") {
        if (typeof value.path === "string" && value.constructor?.name === "DocumentReference") return value.path;
        if (typeof value.latitude === "number" && typeof value.longitude === "number") {
            return { latitude: value.latitude, longitude: value.longitude };
        }
        return Object.fromEntries(
            Object.entries(value)
                .filter(([key]) => !/(password|token|secret|private.?key|api.?key)/i.test(key))
                .map(([key, nested]) => [key, serializeValue(nested)])
        );
    }
    return value;
}

function publicDocument(document) {
    return { id: document.id, ...serializeValue(document.data()) };
}

function matchesSearch(document, term) {
    if (!term) return true;
    return Object.values(document).some(value => {
        if (typeof value === "string") return value.toLowerCase().includes(term);
        if (Array.isArray(value)) return value.some(item => typeof item === "string" && item.toLowerCase().includes(term));
        return false;
    });
}

async function listFirebaseRecords(db, module, { q = "", status = "", limit = 200 } = {}) {
    const collection = COLLECTIONS[module];
    if (!collection) throw validationError("Choose a supported Firebase workspace.");
    const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 200, 1), 300);
    const snapshot = await db.collection(collection)
        .orderBy(SORT_FIELDS[module], "desc")
        .limit(safeLimit)
        .get();
    const term = String(q).trim().slice(0, 80).toLowerCase();
    return snapshot.docs
        .map(publicDocument)
        .filter(record => (!status || record.status === status || record.accountStatus === status || record.active === (status === "active"))
            && matchesSearch(record, term))
        .sort((left, right) => String(right.createdAt || right.addedAt || right.date || "").localeCompare(
            String(left.createdAt || left.addedAt || left.date || "")
        ));
}

async function requireActiveStaff(db, email, department) {
    const snapshot = await db.collection("team").doc(email).get();
    if (!snapshot.exists || snapshot.data().active === false) {
        throw validationError("Select an active staff account.");
    }
    if (snapshot.data().department !== department) {
        throw validationError("The selected staff member must belong to the chosen department.");
    }
    return snapshot.data();
}

async function sendStaffInvitationEmail(invitation, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
    const { RESEND_API_KEY, RESEND_FROM_EMAIL } = env;
    if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
        const error = new Error("Invitation was saved, but the email service is not configured. Configure RESEND_API_KEY and RESEND_FROM_EMAIL, then resend it.");
        error.statusCode = 503;
        throw error;
    }
    if (typeof fetchImpl !== "function") {
        const error = new Error("Invitation was saved, but the server email service is unavailable.");
        error.statusCode = 503;
        throw error;
    }
    const lines = [
        `Hello ${invitation.name},`,
        "",
        "You have been invited to join the JEXOLYT team.",
        `Department: ${invitation.department}`,
        `Designation: ${invitation.designation}`,
        "",
        `Sign in with this email address to accept your invitation: ${STAFF_LOGIN_URL}`,
        "Use Google sign-in or a verified email account. Your staff workspace will open after your invitation is accepted.",
        "",
        "If you were not expecting this invitation, you can ignore this email."
    ];
    let response;
    try {
        response = await fetchImpl("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${RESEND_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                from: RESEND_FROM_EMAIL,
                to: [invitation.email],
                subject: "Your JEXOLYT team invitation",
                text: lines.join("\n")
            }),
            signal: AbortSignal.timeout(10_000)
        });
    } catch (error) {
        console.error("Staff invitation email delivery failed:", error.name);
        const deliveryError = new Error("Invitation was saved, but the email could not be delivered. Retry the invitation from the admin panel.");
        deliveryError.statusCode = 502;
        throw deliveryError;
    }
    if (!response.ok) {
        console.error("Staff invitation email provider rejected the request:", response.status);
        const error = new Error("Invitation was saved, but the email could not be delivered. Retry the invitation from the admin panel.");
        error.statusCode = 502;
        throw error;
    }
}

function validateCreateInput(module, body, actor) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw validationError("Provide valid record details.");
    }
    switch (module) {
        case "invitations": {
            rejectUnknownFields(body, ["email", "name", "department", "designation", "accessRole"]);
            const email = requireEmail(body.email);
            const department = requireDepartment(body.department);
            const accessRole = body.accessRole || "employee";
            if (accessRole !== "employee") throw validationError("New invitations must start with the Employee role.");
            return {
                id: email,
                data: {
                    email,
                    name: requireText(body.name, "Name", 100),
                    department,
                    designation: requireText(body.designation, "Designation", 100),
                    accessRole,
                    invitedByEmail: actor.email,
                    status: "pending",
                    createdAt: FieldValue.serverTimestamp()
                }
            };
        }
        case "tasks":
            rejectUnknownFields(body, ["title", "description", "instructions", "department", "assigneeEmail", "priority", "startDate", "deadline"]);
            if (body.priority !== undefined && !["Normal", "High", "Urgent"].includes(body.priority)) {
                throw validationError("Choose Normal, High, or Urgent priority.");
            }
            {
                const startDate = requireDate(body.startDate, "Start date");
                const deadline = requireDate(body.deadline, "Deadline");
                if (deadline < startDate) throw validationError("Deadline must be on or after the start date.");
                return {
                    data: {
                        title: requireText(body.title, "Task title", 120),
                        description: requireText(body.description || "", "Description", 2000, { optional: true }),
                        instructions: requireText(body.instructions || "", "Instructions", 2000, { optional: true }),
                        department: requireDepartment(body.department),
                        assigneeEmail: requireEmail(body.assigneeEmail, "Assignee email"),
                        assigneeName: "",
                        assignedByEmail: actor.email,
                        priority: body.priority || "Normal",
                        startDate,
                        deadline,
                        status: "new",
                        submission: "",
                        createdAt: FieldValue.serverTimestamp(),
                        updatedAt: FieldValue.serverTimestamp()
                    }
                };
            }
        case "projects": {
            rejectUnknownFields(body, ["title", "description", "department", "memberEmails", "status", "progress", "deadline"]);
            const memberEmails = Array.isArray(body.memberEmails)
                ? [...new Set(body.memberEmails.map(email => requireEmail(email, "Team member email")))]
                : [];
            if (!memberEmails.length || memberEmails.length > 50) {
                throw validationError("Select between 1 and 50 staff members for the project.");
            }
            const status = body.status || "planning";
            if (!PROJECT_STATUSES.includes(status)) throw validationError("Choose a supported project status.");
            const progress = body.progress === undefined ? 0 : Number(body.progress);
            if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
                throw validationError("Project progress must be between 0 and 100.");
            }
            const deadline = body.deadline ? requireDate(body.deadline, "Deadline") : "";
            return {
                data: {
                    title: requireText(body.title, "Project title", 120),
                    description: requireText(body.description || "", "Description", 1500, { optional: true }),
                    department: requireDepartment(body.department),
                    managerEmail: actor.email,
                    memberEmails,
                    status,
                    progress,
                    deadline,
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                }
            };
        }
        case "announcements":
            rejectUnknownFields(body, ["title", "message", "department"]);
            return {
                data: {
                    title: requireText(body.title, "Announcement title", 120),
                    message: requireText(body.message, "Announcement", 2000),
                    department: body.department === "all" ? "all" : requireDepartment(body.department),
                    createdByEmail: actor.email,
                    createdAt: FieldValue.serverTimestamp()
                }
            };
        case "resources": {
            rejectUnknownFields(body, ["title", "category", "department", "url"]);
            const url = requireText(body.url, "Resource URL", 1000);
            let parsedUrl;
            try {
                parsedUrl = new URL(url);
            } catch {
                throw validationError("Resource URL must be a valid HTTPS address.");
            }
            if (parsedUrl.protocol !== "https:") throw validationError("Resource URL must be a valid HTTPS address.");
            return {
                data: {
                    title: requireText(body.title, "Resource title", 120),
                    category: requireText(body.category || "", "Category", 80, { optional: true }),
                    department: body.department === "all" ? "all" : requireDepartment(body.department),
                    url: parsedUrl.toString(),
                    createdByEmail: actor.email,
                    createdAt: FieldValue.serverTimestamp()
                }
            };
        }
        default:
            throw validationError("Creating records in this Firebase workspace is not supported.");
    }
}

function validateUpdateInput(module, body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw validationError("Provide a valid update.");
    }
    if (module === "staff") {
        const allowed = ["name", "designation", "department", "accessRole", "active"];
        if (Object.keys(body).some(key => !allowed.includes(key)) || !Object.keys(body).length) {
            throw validationError("Provide supported staff profile fields.");
        }
        const update = {};
        if (body.name !== undefined) update.name = requireText(body.name, "Name", 100);
        if (body.designation !== undefined) update.designation = requireText(body.designation, "Designation", 100);
        if (body.department !== undefined) update.department = requireDepartment(body.department);
        if (body.accessRole !== undefined) {
            if (!ACCESS_ROLES.includes(body.accessRole)) throw validationError("Choose a supported staff access role.");
            update.accessRole = body.accessRole;
        }
        if (body.active !== undefined) {
            if (typeof body.active !== "boolean") throw validationError("Active must be true or false.");
            update.active = body.active;
        }
        update.updatedAt = FieldValue.serverTimestamp();
        return update;
    }
    if (module === "tasks") {
        rejectUnknownFields(body, ["action", "actorEmail", "feedback"]);
        if (!["approve", "reject", "revision"].includes(body.action)) {
            throw validationError("Choose approve, reject, or request revision.");
        }
        return {
            status: { approve: "completed", reject: "rejected", revision: "revision_required" }[body.action],
            reviewedByEmail: requireEmail(body.actorEmail),
            reviewedAt: FieldValue.serverTimestamp(),
            ...(body.action === "approve" ? { completedAt: FieldValue.serverTimestamp() } : {}),
            updatedAt: FieldValue.serverTimestamp(),
            feedback: requireText(body.feedback || "", "Feedback", 2000, { optional: true })
        };
    }
    if (module === "leave" || module === "corrections") {
        rejectUnknownFields(body, ["status", "actorEmail"]);
        if (!["approved", "rejected"].includes(body.status)) {
            throw validationError("Choose approved or rejected.");
        }
        return {
            status: body.status,
            reviewedByEmail: requireEmail(body.actorEmail),
            reviewedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        };
    }
    if (module === "projects") {
        rejectUnknownFields(body, ["progress", "status"]);
        const allowed = ["progress", "status"];
        if (Object.keys(body).some(key => !allowed.includes(key)) || !Object.keys(body).length) {
            throw validationError("Provide project progress or status.");
        }
        const update = { updatedAt: FieldValue.serverTimestamp() };
        if (body.progress !== undefined) {
            update.progress = Number(body.progress);
            if (!Number.isFinite(update.progress) || update.progress < 0 || update.progress > 100) {
                throw validationError("Project progress must be between 0 and 100.");
            }
        }
        if (body.status !== undefined) {
            if (!PROJECT_STATUSES.includes(body.status)) throw validationError("Choose a supported project status.");
            if (body.status === "completed" && body.progress !== undefined && Number(body.progress) !== 100) {
                throw validationError("Completed projects must have 100% progress.");
            }
            update.status = body.status;
            if (body.status === "completed") update.progress = 100;
        }
        return update;
    }
    throw validationError("Updating records in this Firebase workspace is not supported.");
}

async function createFirebaseRecord(db, module, body, actor, sendInvitation = sendStaffInvitationEmail) {
    if (!CREATE_MODULES.has(module)) throw validationError("Creating records in this Firebase workspace is not supported.");
    const { id, data } = validateCreateInput(module, body, actor);
    if (module === "tasks") {
        const staff = await requireActiveStaff(db, data.assigneeEmail, data.department);
        data.assigneeName = requireText(staff.name || data.assigneeEmail, "Assignee name", 100);
    }
    if (module === "projects") {
        await Promise.all(data.memberEmails.map(email => requireActiveStaff(db, email, data.department)));
    }
    const reference = id
        ? db.collection(COLLECTIONS[module]).doc(id)
        : db.collection(COLLECTIONS[module]).doc();
    if (id && (await reference.get()).exists) throw Object.assign(validationError("An invitation already exists for this email."), { statusCode: 409 });
    await reference.create(data);
    if (module === "invitations") {
        try {
            await sendInvitation(data);
            await reference.update({ emailStatus: "sent", emailSentAt: FieldValue.serverTimestamp() });
        } catch {
            await reference.update({ emailStatus: "failed" });
        }
    }
    return publicDocument(await reference.get());
}

async function updateFirebaseRecord(db, module, id, body, actor, sendInvitation = sendStaffInvitationEmail) {
    const collection = COLLECTIONS[module];
    if (!collection || !id || id.length > 300 || id.includes("/")) {
        throw validationError("Choose a valid Firebase record.");
    }
    if (module === "staff") {
        const email = requireEmail(id);
        const update = validateUpdateInput(module, body);
        const reference = db.collection("team").doc(email);
        const snapshot = await reference.get();
        if (!snapshot.exists) {
            const error = new Error("Staff record not found.");
            error.statusCode = 404;
            throw error;
        }
        const staff = snapshot.data();
        if (update.designation !== undefined) update.role = update.designation;
        if (update.department) {
            const selectedDepartment = update.department;
            const assignedTask = await db.collection("staffTasks")
                .where("assigneeEmail", "==", email)
                .where("status", "in", ["new", "assigned", "in_progress", "under_review", "revision_required"])
                .limit(1).get();
            if (assignedTask.size && selectedDepartment !== staff.department) {
                throw validationError("Reassign or complete this employee's open tasks before changing departments.");
            }
        }
        const batch = db.batch();
        batch.update(reference, update);
        const directory = db.collection("staffDirectory").doc(email);
        const directorySnapshot = await directory.get();
        if (directorySnapshot.exists) {
            const directoryUpdate = {};
            for (const field of ["name", "designation", "department", "accessRole", "active"]) {
                if (update[field] !== undefined) directoryUpdate[field] = update[field];
            }
            directoryUpdate.updatedAt = FieldValue.serverTimestamp();
            batch.update(directory, directoryUpdate);
        }
        await batch.commit();
        return publicDocument(await reference.get());
    }
    if (module === "invitations") {
        rejectUnknownFields(body, ["action"]);
        if (body.action !== "resend-email") throw validationError("Choose resend email.");
        const reference = db.collection(collection).doc(id);
        const snapshot = await reference.get();
        if (!snapshot.exists) {
            const error = new Error("Staff invitation not found.");
            error.statusCode = 404;
            throw error;
        }
        const invitation = snapshot.data();
        if (invitation.status !== "pending") throw validationError("Only pending invitations can be emailed.");
        await sendInvitation(invitation);
        await reference.update({ emailStatus: "sent", emailSentAt: FieldValue.serverTimestamp() });
        return publicDocument(await reference.get());
    }
    if (module === "members") {
        const allowed = ["accountStatus", "featured"];
        if (Object.keys(body).some(key => !allowed.includes(key)) || !Object.keys(body).length) {
            throw validationError("Provide a supported member status or feature update.");
        }
        const reference = db.collection("members").doc(id);
        const snapshot = await reference.get();
        if (!snapshot.exists) {
            const error = new Error("Network member not found.");
            error.statusCode = 404;
            throw error;
        }
        const member = snapshot.data();
        const update = { updatedAt: FieldValue.serverTimestamp() };
        if (body.accountStatus !== undefined) {
            if (!["approved", "rejected", "suspended"].includes(body.accountStatus)) {
                throw validationError("Choose approved, rejected, or suspended.");
            }
            update.accountStatus = body.accountStatus;
            if (body.accountStatus !== "approved") update["visibility.profile"] = false;
        }
        if (body.featured !== undefined) {
            if (typeof body.featured !== "boolean") throw validationError("Featured must be true or false.");
            update.featured = body.featured;
        }
        const batch = db.batch();
        batch.update(reference, update);
        const profileReference = db.collection("publicProfiles").doc(id);
        const profile = await profileReference.get();
        if (profile.exists) {
            const approved = (update.accountStatus || member.accountStatus) === "approved";
            const visible = update["visibility.profile"] === undefined
                ? member.visibility?.profile === true
                : false;
            const publish = approved && visible && profile.data().publishState === "public";
            const profileUpdate = { updatedAt: FieldValue.serverTimestamp() };
            if (update.accountStatus !== undefined) {
                profileUpdate.isPublic = publish;
                profileUpdate.publishState = publish ? "public" : "private";
            }
            if (update.featured !== undefined) profileUpdate.featured = update.featured;
            batch.update(profileReference, profileUpdate);
        }
        if (update.accountStatus && update.accountStatus !== "approved") {
            const projects = await reference.collection("projects").get();
            let projectBatch = db.batch();
            let pendingWrites = 0;
            for (const project of projects.docs) {
                if (project.data().publishState !== "public" && project.data().visibility !== "public") continue;
                projectBatch.update(project.ref, {
                    visibility: "private",
                    publishState: "private",
                    updatedAt: FieldValue.serverTimestamp()
                });
                pendingWrites += 1;
                if (pendingWrites === 450) {
                    await projectBatch.commit();
                    projectBatch = db.batch();
                    pendingWrites = 0;
                }
            }
            if (pendingWrites) await projectBatch.commit();
        }
        await batch.commit();
        return publicDocument(await reference.get());
    }
    if (module === "tasks") {
        const reference = db.collection(collection).doc(id);
        const snapshot = await reference.get();
        if (!snapshot.exists) {
            const error = new Error("Task not found.");
            error.statusCode = 404;
            throw error;
        }
        const task = snapshot.data();
        if (task.status !== "under_review") {
            throw validationError("Only submitted tasks awaiting review can be approved or sent for revision.");
        }
        const update = validateUpdateInput(module, { ...body, actorEmail: actor.email });
        const { feedback, ...taskUpdate } = update;
        const batch = db.batch();
        batch.update(reference, taskUpdate);
        if (feedback) {
            batch.create(reference.collection("comments").doc(), {
                senderEmail: actor.email,
                senderName: actor.fullName,
                text: feedback,
                createdAt: FieldValue.serverTimestamp()
            });
        }
        await batch.commit();
        return publicDocument(await reference.get());
    }
    if (module === "leave" || module === "corrections") {
        const reference = db.collection(collection).doc(id);
        const snapshot = await reference.get();
        if (!snapshot.exists) {
            const error = new Error("Approval request not found.");
            error.statusCode = 404;
            throw error;
        }
        if (snapshot.data().status !== "pending") throw validationError("This request has already been reviewed.");
        const update = validateUpdateInput(module, { ...body, actorEmail: actor.email });
        await reference.update(update);
        return publicDocument(await reference.get());
    }
    if (module === "projects") {
        const update = validateUpdateInput(module, body);
        const reference = db.collection(collection).doc(id);
        const snapshot = await reference.get();
        if (!snapshot.exists) {
            const error = new Error("Project not found.");
            error.statusCode = 404;
            throw error;
        }
        await reference.update(update);
        return publicDocument(await reference.get());
    }
    throw validationError("Updating records in this Firebase workspace is not supported.");
}

function createFirebaseAdminHandlers(getFirestore, writeAudit, emailOptions) {
    function ensureSuperAdmin(req, res) {
        if (req.user?.role !== "super_admin") {
            res.status(403).json({ success: false, message: "Only the Super Admin can manage Firebase workforce records." });
            return false;
        }
        if (process.env.FIREBASE_PROJECT_ID !== "govindkr-dev") {
            res.status(503).json({ success: false, message: "Firebase Admin is not configured for the JEXOLYT project." });
            return false;
        }
        return true;
    }
    return {
        list: async (req, res, next) => {
            if (!ensureSuperAdmin(req, res)) return;
            try {
                const records = await listFirebaseRecords(getFirestore(), req.params.module, req.query);
                res.set("Cache-Control", "no-store");
                return res.json({ success: true, records });
            } catch (error) {
                if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
                return next(error);
            }
        },
        create: async (req, res, next) => {
            if (!ensureSuperAdmin(req, res)) return;
            try {
                const record = await createFirebaseRecord(
                    getFirestore(),
                    req.params.module,
                    req.body,
                    req.user,
                    invitation => sendStaffInvitationEmail(invitation, emailOptions)
                );
                await writeAudit(req, `firebase.${req.params.module}.created`, "data", record.id, `Created Firebase ${req.params.module} record.`);
                res.set("Cache-Control", "no-store");
                return res.status(201).json({ success: true, record });
            } catch (error) {
                if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
                return next(error);
            }
        },
        update: async (req, res, next) => {
            if (!ensureSuperAdmin(req, res)) return;
            try {
                const record = await updateFirebaseRecord(
                    getFirestore(),
                    req.params.module,
                    req.params.id,
                    req.body,
                    req.user,
                    invitation => sendStaffInvitationEmail(invitation, emailOptions)
                );
                await writeAudit(req, `firebase.${req.params.module}.updated`, "data", record.id, `Updated Firebase ${req.params.module} record.`);
                res.set("Cache-Control", "no-store");
                return res.json({ success: true, record });
            } catch (error) {
                if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
                return next(error);
            }
        }
    };
}

module.exports = {
    DEPARTMENTS,
    ACCESS_ROLES,
    COLLECTIONS,
    sendStaffInvitationEmail,
    listFirebaseRecords,
    validateCreateInput,
    validateUpdateInput,
    createFirebaseRecord,
    updateFirebaseRecord,
    createFirebaseAdminHandlers
};
