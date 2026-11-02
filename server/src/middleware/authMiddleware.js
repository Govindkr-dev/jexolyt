const jwt = require("jsonwebtoken");
const User = require("../models/user");
const AdminSession = require("../models/adminSession");
const { SESSION_COOKIE } = require("../controllers/authController");

// Extract token from Authorization header or cookie
function getToken(req) {
    const authorization = req.headers.authorization;

    if (authorization?.startsWith("Bearer ")) {
        return authorization.slice(7).trim();
    }

    return req.cookies?.[SESSION_COOKIE] || null;
}

// Identify JWT errors
function isInvalidToken(error) {
    return (
        error.name === "JsonWebTokenError" ||
        error.name === "TokenExpiredError" ||
        error.name === "NotBeforeError"
    );
}

// Verify JWT
function verifyToken(token) {
    if (!token || !process.env.JWT_SECRET) {
        throw new Error("Authentication configuration error.");
    }

    return jwt.verify(
        token,
        process.env.JWT_SECRET,
        {
            issuer: "jexolyt-admin",
            audience: "jexolyt-admin-panel",
            algorithms: ["HS256"]
        }
    );
}

// Mandatory Authentication
const protect = async (req, res, next) => {
    try {
        const token = getToken(req);

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Access denied. Please login first."
            });
        }

        const decoded = verifyToken(token);

        if (!decoded.id || typeof decoded.sid !== "string") {
            return res.status(401).json({
                success: false,
                message: "Invalid authentication token."
            });
        }

        const [session, user] = await Promise.all([
            AdminSession.findOne({
                _id: decoded.sid,
                userId: decoded.id,
                revokedAt: null,
                expiresAt: { $gt: new Date() }
            }),
            User.findById(decoded.id)
        ]);

        if (!session || !user) {
            return res.status(401).json({
                success: false,
                message: "Your session is no longer valid. Please sign in again."
            });
        }

        if (user.status !== "active") {
            return res.status(403).json({
                success: false,
                message: "Your account is inactive or suspended."
            });
        }

        req.user = user;

        return next();

    } catch (error) {

        if (isInvalidToken(error)) {
            return res.status(401).json({
                success: false,
                message: "Invalid or expired token."
            });
        }

        console.error("Admin authentication failed:", error.name);

        return res.status(500).json({
            success: false,
            message: "Internal server error."
        });
    }
};

// Optional Authentication
const optionalUser = async (req, res, next) => {
    try {
        const token = getToken(req);

        if (!token) {
            return next();
        }

        const decoded = verifyToken(token);

        if (!decoded.id) {
            return next();
        }

        const user = await User.findById(decoded.id);

        if (!user || user.status !== "active") {
            return next();
        }

        req.user = user;

        return next();

    } catch (error) {

        if (isInvalidToken(error)) {
            return next();
        }

        console.error("Optional authentication failed:", error.name);

        return res.status(500).json({
            success: false,
            message: "Authentication service temporarily unavailable."
        });
    }
};

module.exports = {
    protect,
    optionalUser
};