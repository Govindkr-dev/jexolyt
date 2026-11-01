const User = require("../models/user");
const AuditLog = require("../models/auditLog");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const SESSION_COOKIE = "jexolyt_admin_session";
const SESSION_MAX_AGE = 8 * 60 * 60 * 1000;
const REMEMBERED_SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

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

function cookieOptions(rememberMe = false) {
const production = process.env.NODE_ENV === "production";


return {
    httpOnly: true,
    secure: production,
    sameSite: production ? "none" : "lax",
    maxAge: rememberMe ? REMEMBERED_SESSION_MAX_AGE : SESSION_MAX_AGE,
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
    const token = jwt.sign(
        {
            id: user._id.toString()
        },
        process.env.JWT_SECRET,
        {
            expiresIn: rememberMe ? "30d" : "8h",
            issuer: "jexolyt-admin",
            audience: "jexolyt-admin-panel",
            algorithm: "HS256"
        }
    );

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
        cookieOptions(rememberMe)
    );

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

// ==========================================
// ADMIN LOGOUT
// ==========================================

const logout = async (req, res, next) => {
try {
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


    res.clearCookie(
        SESSION_COOKIE,
        {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
            partitioned: process.env.NODE_ENV === "production",
            path: "/"
        }
    );

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
publicUser,
SESSION_COOKIE,
SESSION_MAX_AGE,
cookieOptions
};
