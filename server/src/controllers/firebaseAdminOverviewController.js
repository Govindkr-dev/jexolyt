const ACTIVE_TASK_STATUSES = [
    "new",
    "assigned",
    "in_progress",
    "under_review",
    "revision_required"
];

function countDocuments(query) {
    return query.count().get().then(snapshot => {
        const count = snapshot.data()?.count;
        if (!Number.isSafeInteger(count) || count < 0) {
            throw new Error("Firestore returned an invalid aggregate count.");
        }
        return count;
    });
}

function currentBusinessDate(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

async function loadFirebaseAdminOverview(db, now = new Date()) {
    const attendanceDate = currentBusinessDate(now);
    const count = (collection, field, operator, value) => {
        let query = db.collection(collection);
        if (field) query = query.where(field, operator, value);
        return countDocuments(query);
    };

    const [
        totalStaff,
        inactiveStaff,
        totalNetworkMembers,
        approvedNetworkMembers,
        totalClients,
        activeProjects,
        totalTasks,
        pendingTasks,
        tasksAwaitingReview,
        completedTasks,
        presentToday,
        pendingLeaveRequests,
        pendingAttendanceCorrections
    ] = await Promise.all([
        count("team"),
        count("team", "active", "==", false),
        count("members"),
        count("members", "accountStatus", "==", "approved"),
        count("clients"),
        count("staffProjects", "status", "in", ["in_progress", "active"]),
        count("staffTasks"),
        count("staffTasks", "status", "in", ACTIVE_TASK_STATUSES),
        count("staffTasks", "status", "==", "under_review"),
        count("staffTasks", "status", "==", "completed"),
        count("attendance", "date", "==", attendanceDate),
        count("leaveRequests", "status", "==", "pending"),
        count("attendanceCorrections", "status", "==", "pending")
    ]);

    return {
        staff: { total: totalStaff, active: totalStaff - inactiveStaff },
        networkMembers: { total: totalNetworkMembers, approved: approvedNetworkMembers },
        clients: totalClients,
        activeProjects,
        tasks: {
            total: totalTasks,
            pending: pendingTasks,
            awaitingReview: tasksAwaitingReview,
            completed: completedTasks
        },
        attendance: { presentToday, date: attendanceDate },
        pendingApprovals: pendingLeaveRequests + pendingAttendanceCorrections + tasksAwaitingReview,
        leave: { pending: pendingLeaveRequests }
    };
}

function createFirebaseAdminOverviewHandler(getFirestore) {
    return async (req, res, next) => {
        if (req.user?.role !== "super_admin") {
            return res.status(403).json({
                success: false,
                message: "Only the Super Admin can view Firebase workforce metrics."
            });
        }

        if (process.env.FIREBASE_PROJECT_ID !== "govindkr-dev") {
            return res.status(503).json({
                success: false,
                message: "Firebase Admin is not configured for the JEXOLYT project."
            });
        }

        try {
            const summary = await loadFirebaseAdminOverview(getFirestore());
            res.set("Cache-Control", "no-store");
            return res.status(200).json({ success: true, summary });
        } catch (error) {
            return next(error);
        }
    };
}

module.exports = {
    ACTIVE_TASK_STATUSES,
    currentBusinessDate,
    loadFirebaseAdminOverview,
    createFirebaseAdminOverviewHandler
};
