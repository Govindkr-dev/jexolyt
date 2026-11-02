const crypto = require("crypto");
const User = require("../models/user");
const AuditLog = require("../models/auditLog");
const AdminSession = require("../models/adminSession");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const SESSION_COOKIE = "jexolyt_admin_session";
const REFRESH_COOKIE = "jexolyt_admin_refresh";
const ACCESS_TOKEN_TTL = "15m";
const ACCESS_COOKIE_MAX_AGE = 15 * 60 * 1000;
const SESSION_MAX_AGE = 8 * 60 * 60 * 1000;
const REMEMBERED_SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

function hashRefreshToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

function accessToken(userId, sessionId) {
    return jwt.sign(
        { id: userId.toString(), sid: sessionId.toString() },
        process.env.JWT_SECRET,
        {
            expiresIn: ACCESS_TOKEN_TTL,
            issuer: "jexolyt-admin",
            audience: "jexolyt-admin-panel",
            algorithm: "HS256"
        }
    );
}

function refreshCookieOptions(maxAge) {
    const production = process.env.NODE_ENV === "production";
    return {
        httpOnly: true,
        secure: production,
        sameSite: production ? "none" : "lax",
        maxAge,
        partitioned: production,
        path: "/api/auth"
    };
}

function clearSessionCookies(res) {
    const production = process.env.NODE_ENV === "production";
    res.clearCookie(SESSION_COOKIE, {
        httpOnly: true,
        secure: production,
        sameSite: production ? "none" : "lax",
        partitioned: production,
        path: "/"
    });
    res.clearCookie(REFRESH_COOKIE, {
        httpOnly: true,
        secure: production,
        sameSite: production ? "none" : "lax",
        partitioned: production,
        path: "/api/auth"
    });
}

function publicUser(user) {
const permissions = user.permissions instanceof Map
? Object.fromEntries(
[...user.permissions].map(([module, actions]) => [
module,
actions?.toObject
? actions.toObject()
: { ...actions }
])
)
: user.permissions || {};


return {
    id: user._id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    status: user.status,
    permissions
};


}

function cookieOptions() {
const production = process.env.NODE_ENV === "production";


return {
    httpOnly: true,
    secure: production,
    sameSite: production ? "none" : "lax",
    maxAge: ACCESS_COOKIE_MAX_AGE,
    partitioned: production,
    path: "/"
};


}

// ==========================================
// ADMIN LOGIN
// ==========================================

const login = async (req, res) => {
try {
const { email, password } = req.body || {};


    if (
        typeof email !== "string" ||
        typeof password !== "string" ||
        !email.trim() ||
        !password
    ) {
        return res.status(400).json({
            success: false,
            message: "Email and password are required."
        });
    }

    if (email.length > 254 || password.length > 1024) {
        return res.status(400).json({
            success: false,
            message: "Email or password is too long."
        });
    }

    if (
        !process.env.JWT_SECRET ||
        process.env.JWT_SECRET.length < 32
    ) {
        return res.status(503).json({
            success: false,
            message: "Authentication is not configured."
        });
    }

    const user = await User.findOne({
        email: email.trim().toLowerCase()
    }).select("+password");

    if (
        !user ||
        user.status !== "active" ||
        !(await bcrypt.compare(password, user.password))
    ) {
        return res.status(401).json({
            success: false,
            message: "Invalid email or password."
        });
    }

    const rememberMe = req.body.rememberMe === true;
    const refreshLifetime = rememberMe ? REMEMBERED_SESSION_MAX_AGE : SESSION_MAX_AGE;
    const refreshToken = crypto.randomBytes(32).toString("base64url");
    const familyId = crypto.randomUUID();
    const session = await AdminSession.create({
        userId: user._id,
        familyId,
        refreshTokenHash: hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + refreshLifetime)
    });
    const token = accessToken(user._id, session._id);

    user.lastLogin = new Date();
    await user.save();

    try {
        await AuditLog.create({
            actor: user._id,
            actorEmail: user.email,
            action: "auth.login",
            module: "users",
            targetId: user._id.toString(),
            summary: "Admin signed in."
        });
    } catch (auditError) {
        console.error("Login audit logging failed:", auditError.name);
    }

    res.cookie(
        SESSION_COOKIE,
        token,
        cookieOptions()
    );
    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions(refreshLifetime));

    return res.status(200).json({
        success: true,
        message: "Login successful.",
        user: publicUser(user)
    });

} catch (error) {
    console.error("Admin login failed:", error.name);

    return res.status(500).json({
        success: false,
        message: "Unable to sign in right now."
    });
}


};

const refresh = async (req, res) => {
    try {
        const token = req.cookies?.[REFRESH_COOKIE];
        if (!token) {
            clearSessionCookies(res);
            return res.status(401).json({ success: false, message: "Your session has ended. Please sign in again." });
        }

        const now = new Date();
        const existingSession = await AdminSession.findOne({
            refreshTokenHash: hashRefreshToken(token)
        });
        if (!existingSession || existingSession.expiresAt <= now) {
            clearSessionCookies(res);
            return res.status(401).json({ success: false, message: "Your session has ended. Please sign in again." });
        }
        if (existingSession.revokedAt) {
            await AdminSession.updateMany(
                { familyId: existingSession.familyId, revokedAt: null },
                { $set: { revokedAt: now } }
            );
            clearSessionCookies(res);
            return res.status(401).json({ success: false, message: "This session could not be renewed. Please sign in again." });
        }

        const session = await AdminSession.findOneAndUpdate(
            { refreshTokenHash: hashRefreshToken(token), revokedAt: null, expiresAt: { $gt: now } },
            { $set: { revokedAt: now } },
            { new: false }
        );
        if (!session) {
            clearSessionCookies(res);
            return res.status(401).json({ success: false, message: "Your session has ended. Please sign in again." });
        }

        const user = await User.findById(session.userId);
        if (!user || user.status !== "active") {
            clearSessionCookies(res);
            return res.status(401).json({ success: false, message: "This account cannot continue its session." });
        }

        const rotatedToken = crypto.randomBytes(32).toString("base64url");
        const rotatedSession = await AdminSession.create({
            userId: user._id,
            familyId: session.familyId,
            refreshTokenHash: hashRefreshToken(rotatedToken),
            expiresAt: session.expiresAt
        });
        await AdminSession.updateOne(
            { _id: session._id },
            { $set: { replacedBy: rotatedSession._id } }
        );

        res.cookie(SESSION_COOKIE, accessToken(user._id, rotatedSession._id), cookieOptions());
        res.cookie(
            REFRESH_COOKIE,
            rotatedToken,
            refreshCookieOptions(Math.max(0, session.expiresAt.getTime() - now.getTime()))
        );
        return res.status(200).json({ success: true, user: publicUser(user) });
    } catch (error) {
        console.error("Admin session refresh failed:", error.name);
        return res.status(500).json({ success: false, message: "Unable to renew your session right now." });
    }
};

// ==========================================
// ADMIN LOGOUT
// ==========================================

const logout = async (req, res, next) => {
try {
const refreshToken = req.cookies?.[REFRESH_COOKIE];
if (refreshToken) {
    await AdminSession.updateOne(
        { refreshTokenHash: hashRefreshToken(refreshToken), revokedAt: null },
        { $set: { revokedAt: new Date() } }
    );
}
if (req.user) {
try {
await AuditLog.create({
actor: req.user._id,
actorEmail: req.user.email,
action: "auth.logout",
module: "users",
targetId: req.user._id.toString(),
summary: "Admin signed out."
});
} catch (auditError) {
console.error("Logout audit logging failed:", auditError.name);
}
}


    clearSessionCookies(res);

    return res.status(200).json({
        success: true,
        message: "Logout successful."
    });

} catch (error) {
    return next(error);
}


};

module.exports = {
login,
logout,
refresh,
publicUser,
SESSION_COOKIE,
REFRESH_COOKIE,
SESSION_MAX_AGE,
cookieOptions,
refreshCookieOptions,
ACCESS_COOKIE_MAX_AGE,
ACCESS_TOKEN_TTL,
REMEMBERED_SESSION_MAX_AGE,
hashRefreshToken,
accessToken
};
