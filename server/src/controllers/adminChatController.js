const { getAuth } = require("firebase-admin/auth");
const { getFirebaseAdminApp } = require("../services/firebaseAdminApp");

const CHAT_ACCESS_TTL_MS = 30 * 60 * 1000;

function buildAdminChatIdentity(user, now = Date.now()) {
    const id = user?._id?.toString();
    if (!id || !/^[a-f\d]{24}$/i.test(id)) {
        throw new TypeError("A valid admin account is required.");
    }

    return {
        uid: `jexolyt_admin_${id}`,
        claims: {
            jexolytAdmin: true,
            adminRole: user.role,
            adminEmail: user.email,
            adminName: user.fullName,
            chatExpiresAt: now + CHAT_ACCESS_TTL_MS
        }
    };
}

async function createAdminChatToken(req, res, next) {
    try {
        if (!["admin", "super_admin"].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: "An active JEXOLYT admin account is required." });
        }

        const { uid, claims } = buildAdminChatIdentity(req.user);
        const customToken = await getAuth(getFirebaseAdminApp()).createCustomToken(uid, claims);
        res.set("Cache-Control", "no-store");
        return res.status(200).json({ success: true, customToken });
    } catch (error) {
        if (error instanceof TypeError) {
            return res.status(400).json({ success: false, message: error.message });
        }
        return next(error);
    }
}

module.exports = { CHAT_ACCESS_TTL_MS, buildAdminChatIdentity, createAdminChatToken };
