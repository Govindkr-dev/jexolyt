const express = require("express");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const AdminRecord = require("../models/record");
const AuditLog = require("../models/auditLog");
const User = require("../models/user");
const { protect } = require("../middleware/authMiddleware");
const { MODULES, hasPermission, cleanPermissions, validateRecordInput } = require("../utils/adminPermissions");

const router = express.Router();
const recordModules = MODULES.filter(module => ![
    "dashboard", "users", "activity-logs", "search", "data"
].includes(module));
const ADMIN_DEFAULT_PERMISSIONS = {
    dashboard: { view: true, create: true, edit: true, delete: true },
    users: { view: true, create: true, edit: true, delete: false },
    departments: { view: true, create: true, edit: true, delete: false },
    projects: { view: true, create: true, edit: true, delete: false },
    clients: { view: true, create: true, edit: true, delete: false },
    finance: { view: true, create: true, edit: true, delete: false },
    settings: { view: true, create: true, edit: true, delete: false },
    reports: { view: true, create: true, edit: true, delete: false }
};

function requirePermission(module, action) {
    return (req, res, next) => {
        if (!hasPermission(req.user, module, action)) {
            return res.status(403).json({ success: false, message: "You do not have permission to perform this action." });
        }
        return next();
    };
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toPublicRecord(record) {
    return {
        id: record._id,
        module: record.module,
        title: record.title,
        status: record.status,
        data: record.data,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
    };
}

function toPublicUser(user) {
    const permissions = user.permissions instanceof Map
        ? Object.fromEntries([...user.permissions].map(([module, actions]) => [
            module,
            actions?.toObject ? actions.toObject() : { ...actions }
        ]))
        : user.permissions || {};
    return {
        id: user._id.toString(),
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        status: user.status,
        permissions,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt
    };
}

async function writeAudit(req, action, module, targetId, summary) {
    await AuditLog.create({
        actor: req.user._id,
        actorEmail: req.user.email,
        action,
        module,
        targetId: targetId || null,
        summary
    });
}

function cleanRecordBody(body, module) {
    try {
        return validateRecordInput(body, module);
    } catch (error) {
        const validationError = new Error(error.message);
        validationError.statusCode = 400;
        throw validationError;
    }
}

router.use(protect);

router.get("/dashboard", requirePermission("dashboard", "view"), async (req, res, next) => {
    try {
        const [users, counts, recentActivity, recentProjects, revenue, activityTrend, auditLogs] = await Promise.all([
            hasPermission(req.user, "users", "view") ? User.countDocuments() : 0,
            AdminRecord.aggregate([
                { $match: { deletedAt: null } },
                { $group: { _id: "$module", count: { $sum: 1 } } }
            ]),
            hasPermission(req.user, "activity-logs", "view")
                ? AuditLog.find().sort({ createdAt: -1 }).limit(8).lean()
                : [],
            hasPermission(req.user, "projects", "view")
                ? AdminRecord.find({ module: "projects", deletedAt: null }).sort({ updatedAt: -1 }).limit(5).lean()
                : [],
            hasPermission(req.user, "finance", "view")
                ? AdminRecord.aggregate([
                    { $match: { module: "finance", "data.transactionType": "income", status: { $in: ["paid", "received"] }, deletedAt: null } },
                    { $group: { _id: null, total: { $sum: { $convert: { input: "$data.amount", to: "double", onError: 0, onNull: 0 } } } } }
                ])
                : [],
            hasPermission(req.user, "activity-logs", "view")
                ? AuditLog.aggregate([
                    { $match: { createdAt: { $gte: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000) } } },
                    { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" } }, count: { $sum: 1 } } },
                    { $sort: { _id: 1 } }
                ])
                : [],
            hasPermission(req.user, "activity-logs", "view") ? AuditLog.countDocuments() : 0
        ]);
        const moduleCounts = Object.fromEntries(
            counts
                .filter(item => hasPermission(req.user, item._id, "view"))
                .map(item => [item._id, item.count])
        );
        const openSupport = hasPermission(req.user, "support", "view")
            ? await AdminRecord.countDocuments({ module: "support", status: { $in: ["open", "in-progress", "pending"] }, deletedAt: null })
            : 0;
        return res.json({
            success: true,
            summary: {
                admins: users,
                departments: moduleCounts.departments || 0,
                projects: moduleCounts.projects || 0,
                clients: moduleCounts.clients || 0,
                openSupport,
                recordedRevenue: revenue[0]?.total || 0,
                auditLogs
            },
            modules: moduleCounts,
            recentActivity,
            recentProjects: recentProjects.map(toPublicRecord),
            activityTrend: activityTrend.map(item => ({ date: item._id, count: item.count }))
        });
    } catch (error) {
        return next(error);
    }
});

router.get("/users", requirePermission("users", "view"), async (req, res, next) => {
    try {
        const users = await User.find().select("-password").sort({ createdAt: -1 }).limit(200);
        return res.json({ success: true, users: users.map(toPublicUser) });
    } catch (error) {
        return next(error);
    }
});

router.post("/users", protect, async (req, res, next) => {
    try {
        if (req.user.role !== "super_admin") {
            return res.status(403).json({ success: false, message: "Only the Super Admin can create admin accounts." });
        }
        const { fullName, email, password, permissions } = req.body;
        if (
            typeof fullName !== "string" || !fullName.trim() || fullName.trim().length > 100 ||
            typeof email !== "string" || email.length > 254 ||
            typeof password !== "string" || password.length < 12 || password.length > 1024
        ) {
            return res.status(400).json({ success: false, message: "Provide a name, valid email, and password of 12–1,024 characters." });
        }
        const normalizedEmail = email.trim().toLowerCase();
        if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(normalizedEmail)) {
            return res.status(400).json({ success: false, message: "Enter a valid email address." });
        }
        let safePermissions;
        try {
            safePermissions = cleanPermissions(permissions || ADMIN_DEFAULT_PERMISSIONS);
        } catch (error) {
            return res.status(400).json({ success: false, message: error.message });
        }
        const user = await User.create({
            fullName: fullName.trim(),
            email: normalizedEmail,
            password: await bcrypt.hash(password, 12),
            role: "admin",
            status: "active",
            permissions: safePermissions,
            createdBy: req.user._id
        });
        await writeAudit(req, "user.created", "users", user._id.toString(), "Created an admin account.");
        return res.status(201).json({
            success: true,
            user: toPublicUser(user)
        });
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ success: false, message: "An account with this email already exists." });
        return next(error);
    }
});

router.patch("/users/:id", async (req, res, next) => {
    try {
        if (req.user.role !== "super_admin") {
            return res.status(403).json({ success: false, message: "Only the Super Admin can change admin accounts." });
        }
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: "Invalid admin account ID." });
        }
        if (req.user._id.toString() === req.params.id) {
            return res.status(400).json({ success: false, message: "You cannot change your own account permissions or status." });
        }
        const update = {};
        if (req.body.status !== undefined) {
            if (!["active", "inactive", "suspended"].includes(req.body.status)) {
                return res.status(400).json({ success: false, message: "Choose an allowed account status." });
            }
            update.status = req.body.status;
        }
        if (req.body.permissions !== undefined) {
            try {
                update.permissions = cleanPermissions(req.body.permissions);
            } catch (error) {
                return res.status(400).json({ success: false, message: error.message });
            }
        }
        if (!Object.keys(update).length || Object.keys(req.body).some(key => !["status", "permissions"].includes(key))) {
            return res.status(400).json({ success: false, message: "Provide only a status or permission update." });
        }
        const user = await User.findOneAndUpdate(
            { _id: req.params.id, role: "admin" },
            { $set: update },
            { new: true, runValidators: true }
        ).select("-password");
        if (!user) return res.status(404).json({ success: false, message: "Admin account not found." });
        await writeAudit(req, "user.updated", "users", user._id.toString(), "Updated an admin account.");
        return res.json({ success: true, user: toPublicUser(user) });
    } catch (error) {
        return next(error);
    }
});

router.get("/records/:module", async (req, res, next) => {
    try {
        const { module } = req.params;
        if (!recordModules.includes(module)) return res.status(404).json({ success: false, message: "Admin module not found." });
        if (!hasPermission(req.user, module, "view")) return res.status(403).json({ success: false, message: "You do not have permission to view this module." });
        const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
        const filter = { module, deletedAt: null };
        if (typeof req.query.status === "string" && req.query.status.length <= 40) filter.status = req.query.status;
        if (typeof req.query.q === "string" && req.query.q.trim()) {
            const search = new RegExp(escapeRegex(req.query.q.trim().slice(0, 80)), "i");
            filter.$or = [{ title: search }, { "data.description": search }, { "data.content": search }];
        }
        const records = await AdminRecord.find(filter).sort({ updatedAt: -1 }).limit(limit).lean();
        return res.json({ success: true, records: records.map(toPublicRecord) });
    } catch (error) {
        return next(error);
    }
});

router.post("/records/:module", requirePermission("dashboard", "view"), async (req, res, next) => {
    try {
        const { module } = req.params;
        if (!recordModules.includes(module)) return res.status(404).json({ success: false, message: "Admin module not found." });
        if (!hasPermission(req.user, module, "create")) return res.status(403).json({ success: false, message: "You do not have permission to create records in this module." });
        const input = cleanRecordBody(req.body, module);
        const record = await AdminRecord.create({
            module,
            ...input,
            createdBy: req.user._id,
            updatedBy: req.user._id
        });
        await writeAudit(req, "record.created", module, record._id.toString(), "Created a record.");
        return res.status(201).json({ success: true, record: toPublicRecord(record) });
    } catch (error) {
        return next(error);
    }
});

router.patch("/records/:module/:id", async (req, res, next) => {
    try {
        const { module, id } = req.params;
        if (!recordModules.includes(module)) return res.status(404).json({ success: false, message: "Admin module not found." });
        if (!hasPermission(req.user, module, "edit")) return res.status(403).json({ success: false, message: "You do not have permission to edit records in this module." });
        if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid record ID." });
        const input = cleanRecordBody(req.body, module);
        const record = await AdminRecord.findOneAndUpdate(
            { _id: id, module, deletedAt: null },
            { $set: { ...input, updatedBy: req.user._id } },
            { new: true, runValidators: true }
        );
        if (!record) return res.status(404).json({ success: false, message: "Record not found." });
        await writeAudit(req, "record.updated", module, record._id.toString(), "Updated a record.");
        return res.json({ success: true, record: toPublicRecord(record) });
    } catch (error) {
        return next(error);
    }
});

router.patch("/records/website/:id/read-state", async (req, res, next) => {
    try {
        if (!hasPermission(req.user, "website", "edit")) {
            return res.status(403).json({ success: false, message: "You do not have permission to update website submissions." });
        }
        if (!mongoose.isValidObjectId(req.params.id) || typeof req.body.read !== "boolean") {
            return res.status(400).json({ success: false, message: "A valid submission ID and read state are required." });
        }
        const record = await AdminRecord.findOne({
            _id: req.params.id,
            module: "website",
            "data.type": "contact-submission",
            deletedAt: null
        });
        if (!record) return res.status(404).json({ success: false, message: "Website submission not found." });
        record.data.read = req.body.read;
        record.status = req.body.read ? "read" : "new";
        record.updatedBy = req.user._id;
        await record.save();
        await writeAudit(req, "website.submission.updated", "website", record._id.toString(), "Updated a contact submission's read state.");
        return res.json({ success: true, record: toPublicRecord(record) });
    } catch (error) {
        return next(error);
    }
});

router.delete("/records/:module/:id", async (req, res, next) => {
    try {
        const { module, id } = req.params;
        if (!recordModules.includes(module)) return res.status(404).json({ success: false, message: "Admin module not found." });
        if (!hasPermission(req.user, module, "delete")) return res.status(403).json({ success: false, message: "You do not have permission to delete records in this module." });
        if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid record ID." });
        const record = await AdminRecord.findOneAndUpdate(
            { _id: id, module, deletedAt: null },
            { $set: { deletedAt: new Date(), deletedBy: req.user._id, updatedBy: req.user._id } },
            { new: true }
        );
        if (!record) return res.status(404).json({ success: false, message: "Record not found." });
        await writeAudit(req, "record.archived", module, record._id.toString(), "Archived a record.");
        return res.json({ success: true, message: "Record archived." });
    } catch (error) {
        return next(error);
    }
});

router.get("/activity", requirePermission("activity-logs", "view"), async (req, res, next) => {
    try {
        const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(100).lean();
        return res.json({ success: true, logs });
    } catch (error) {
        return next(error);
    }
});

router.get("/search", requirePermission("search", "view"), async (req, res, next) => {
    try {
        const term = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
        if (term.length < 2) return res.status(400).json({ success: false, message: "Enter at least two characters to search." });
        const regex = new RegExp(escapeRegex(term), "i");
        const modules = recordModules.filter(module => hasPermission(req.user, module, "view"));
        const results = await AdminRecord.find({
            module: { $in: modules },
            deletedAt: null,
            $or: [{ title: regex }, { "data.description": regex }, { "data.content": regex }]
        }).sort({ updatedAt: -1 }).limit(50).lean();
        return res.json({ success: true, results: results.map(toPublicRecord) });
    } catch (error) {
        return next(error);
    }
});

router.get("/reports/export", requirePermission("reports", "view"), async (req, res, next) => {
    try {
        const module = typeof req.query.module === "string" ? req.query.module : "";
        if (!recordModules.includes(module) || !hasPermission(req.user, module, "view")) {
            return res.status(403).json({ success: false, message: "You do not have permission to export this module." });
        }
        const records = await AdminRecord.find({ module, deletedAt: null }).sort({ createdAt: -1 }).limit(5000).lean();
        const csvEscape = value => `"${String(value ?? "").replace(/"/g, '""').replace(/^[\u0000-\u0020]*([=+\-@])/, "'$&")}"`;
        const rows = [
            ["Title", "Status", "Description", "Amount", "Transaction Type", "Category", "Created At"],
            ...records.map(record => [
                record.title,
                record.status,
                record.data?.description,
                record.data?.amount,
                record.data?.transactionType,
                record.data?.category,
                record.createdAt?.toISOString()
            ])
        ];
        await writeAudit(req, "report.exported", "reports", module, `Exported ${module} records to CSV.`);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="jexolyt-${module}-report.csv"`);
        return res.send(`\uFEFF${rows.map(row => row.map(csvEscape).join(",")).join("\r\n")}`);
    } catch (error) {
        return next(error);
    }
});

router.get("/data/export", requirePermission("data", "view"), async (req, res, next) => {
    try {
        const modules = recordModules.filter(module => hasPermission(req.user, module, "view"));
        const records = await AdminRecord.find({ module: { $in: modules }, deletedAt: null }).sort({ createdAt: -1 }).limit(10000).lean();
        await writeAudit(req, "data.exported", "data", null, "Exported accessible admin records.");
        return res.json({ success: true, exportedAt: new Date().toISOString(), records: records.map(toPublicRecord) });
    } catch (error) {
        return next(error);
    }
});

router.get("/notifications/unread-count", async (req, res, next) => {
    try {
        const canView = hasPermission(req.user, "notifications", "view");
        if (!canView) return res.json({ success: true, count: 0 });
        const count = await AdminRecord.countDocuments({ module: "notifications", "data.read": { $ne: true }, deletedAt: null });
        return res.json({ success: true, count });
    } catch (error) {
        return next(error);
    }
});

module.exports = { router, recordModules, ADMIN_DEFAULT_PERMISSIONS, requirePermission };
