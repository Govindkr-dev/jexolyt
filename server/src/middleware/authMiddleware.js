const jwt = require("jsonwebtoken");
const User = require("../models/user");
const { SESSION_COOKIE } = require("../controllers/authController");

function getToken(req) {
    if (req.headers.authorization?.startsWith("Bearer ")) {
        return req.headers.authorization.split(" ")[1];
    }
    return req.cookies?.[SESSION_COOKIE];
}

function isInvalidToken(error) {
    return error.name === "JsonWebTokenError" || error.name === "TokenExpiredError";
}

// VERIFY AUTHENTICATION
const protect = async (req, res, next) => {
    try {
        const token = getToken(req);

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Access denied. Please login first."
            });
        }

        // Verify JWT
        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET,
            { issuer: "jexolyt-admin", audience: "jexolyt-admin-panel", algorithms: ["HS256"] }
        );

        // Find user
        const user = await User.findById(decoded.id);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "User no longer exists."
            });
        }

        // Check account status
        if (user.status !== "active") {
            return res.status(403).json({
                success: false,
                message: "Your account is inactive or suspended."
            });
        }

        // Attach user to request
        req.user = user;

        next();

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

const optionalUser = async (req, res, next) => {
    const token = getToken(req);
    if (!token) return next();
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, {
            issuer: "jexolyt-admin",
            audience: "jexolyt-admin-panel",
            algorithms: ["HS256"]
        });
        req.user = await User.findById(decoded.id);
        return next();
    } catch (error) {
        if (isInvalidToken(error)) return next();
        console.error("Could not read admin session:", error.name);
        return res.status(500).json({ success: false, message: "The session could not be closed." });
    }
};

module.exports = { protect, optionalUser };