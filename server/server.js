require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");

// Database
const connectDB = require("./src/config/db");

// Routes
const authRoutes = require("./src/routes/authRoutes");
const { router: adminRoutes } = require("./src/routes/adminRoutes");
const publicRoutes = require("./src/routes/publicRoutes");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { getFirebaseAdminApp } = require("./src/services/firebaseAdminApp");
const { createChatNotificationHandler } = require("./src/controllers/chatNotificationController");
const { createProjectEstimateHandler } = require("./src/controllers/projectEstimateController");

// Initialize Express
const app = express();

// ==========================================
// ENVIRONMENT CONFIGURATION
// ==========================================

const NODE_ENV = process.env.NODE_ENV || "development";

// Render automatically provides PORT.
// Local development defaults to 5000.
const PORT = Number(process.env.PORT) || 5000;

// Always bind to all network interfaces.
// Required for Render deployment.
const HOST = "0.0.0.0";

// Allowed frontend origins
const allowedOrigins = new Set([
    "https://jexolyt.web.app",
    "https://jexolyt.firebaseapp.com",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",

    ...(process.env.CLIENT_URL || "")
        .split(",")
        .map(origin => origin.trim())
        .filter(Boolean)
]);

// ==========================================
// EXPRESS SECURITY
// ==========================================

app.disable("x-powered-by");

// Trust Render's reverse proxy in production
if (NODE_ENV === "production") {
    app.set("trust proxy", 1);
}

// Security headers
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],

                scriptSrc: [
                    "'self'",
                    "'unsafe-inline'",
                    "https://www.gstatic.com",
                    "https://apis.google.com"
                ],

                styleSrc: [
                    "'self'",
                    "'unsafe-inline'",
                    "https://fonts.googleapis.com"
                ],

                fontSrc: [
                    "'self'",
                    "https://fonts.gstatic.com",
                    "data:"
                ],

                imgSrc: [
                    "'self'",
                    "data:",
                    "blob:",
                    "https:"
                ],

                connectSrc: [
                    "'self'",
                    "https://*.googleapis.com",
                    "https://*.firebaseio.com",
                    "https://*.firebaseapp.com",
                    "https://firebasestorage.googleapis.com",
                    "https://identitytoolkit.googleapis.com",
                    "https://securetoken.googleapis.com",
                    "https://firebaseinstallations.googleapis.com",
                    "wss://*.firebaseio.com"
                ],

                frameSrc: [
                    "'self'",
                    "https://*.firebaseapp.com",
                    "https://accounts.google.com",
                    "https://www.youtube.com"
                ],

                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'"]
            }
        }
    })
);

// ==========================================
// CORS CONFIGURATION
// ==========================================

app.use(
    cors({
        origin(origin, callback) {

            // Allow requests without an Origin header
            // (health checks and server-to-server requests).
            if (!origin) {
                return callback(null, true);
            }

            if (allowedOrigins.has(origin)) {
                return callback(null, true);
            }

            return callback(
                new Error("Origin not allowed by CORS.")
            );
        },

        credentials: true,

        methods: [
            "GET",
            "POST",
            "PATCH",
            "PUT",
            "DELETE",
            "OPTIONS"
        ],

        allowedHeaders: [
            "Content-Type",
            "Authorization",
            "X-Setup-Key"
        ]
    })
);

// ==========================================
// BODY PARSERS
// ==========================================

app.use(
    express.json({
        limit: "256kb"
    })
);

app.use(
    express.urlencoded({
        extended: false,
        limit: "32kb"
    })
);

app.use(cookieParser());

// ==========================================
// GLOBAL RATE LIMITER
// ==========================================

const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,

    limit: 200,

    standardHeaders: "draft-8",

    legacyHeaders: false,

    message: {
        success: false,
        message: "Too many requests. Please try again later."
    }
});

app.use(globalLimiter);

// ==========================================
// TRUSTED ORIGIN MIDDLEWARE
// ==========================================

function requireTrustedOrigin(req, res, next) {

    const protectedMethods = [
        "POST",
        "PUT",
        "PATCH",
        "DELETE"
    ];

    if (!protectedMethods.includes(req.method)) {
        return next();
    }

    const origin = req.get("origin");

    if (!origin || !allowedOrigins.has(origin)) {

        return res.status(403).json({
            success: false,
            message: "Requests must come from an authorized website origin."
        });

    }

    next();
}

// ==========================================
// HEALTH CHECK
// ==========================================

app.get("/api/health", (req, res) => {

    return res.status(200).json({
        success: true,
        service: "JEXOLYT Admin API",
        status: "Running",
        environment: NODE_ENV,
        timestamp: new Date().toISOString()
    });

});

// ==========================================
// AUTHENTICATION RATE LIMITER
// ==========================================

const authLimiter = rateLimit({

    windowMs: 15 * 60 * 1000,

    limit: 10,

    standardHeaders: "draft-8",

    legacyHeaders: false,

    message: {
        success: false,
        message: "Too many login attempts. Please try again later."
    }

});

// ==========================================
// SUPER ADMIN SETUP RATE LIMITER
// ==========================================

const setupLimiter = rateLimit({

    windowMs: 60 * 60 * 1000,

    limit: 3,

    standardHeaders: "draft-8",

    legacyHeaders: false,

    message: {
        success: false,
        message: "Too many setup attempts. Please try again later."
    }

});

const chatNotificationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many chat notifications were requested. Please try again later."
    }
});

const projectEstimateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many estimate requests. Please try again later."
    }
});

// ==========================================
// API ROUTES
// ==========================================

// Authentication
app.use(
    "/api/auth/login",
    authLimiter
);

app.post(
    "/api/auth/setup",
    setupLimiter
);

app.use(
    "/api/auth",
    requireTrustedOrigin,
    authRoutes
);

// Admin routes
app.use(
    "/api/admin",
    requireTrustedOrigin,
    adminRoutes
);

// Public routes
app.post(
    "/api/public/chat-notification",
    requireTrustedOrigin,
    chatNotificationLimiter,
    createChatNotificationHandler({
        verifyIdToken: token => getAuth(getFirebaseAdminApp()).verifyIdToken(token),
        getFirestore: () => getFirestore(getFirebaseAdminApp())
    })
);

app.post(
    "/api/public/project-estimate",
    requireTrustedOrigin,
    projectEstimateLimiter,
    createProjectEstimateHandler()
);

app.use(
    "/api/public",
    publicRoutes
);

// ==========================================
// 404 HANDLER
// ==========================================

app.use((req, res) => {

    return res.status(404).json({
        success: false,
        message: "API endpoint not found."
    });

});

// ==========================================
// GLOBAL ERROR HANDLER
// ==========================================

app.use((error, req, res, next) => {

    if (res.headersSent) {
        return next(error);
    }

    console.error("Request failed:", error.name);

    if (error.message === "Origin not allowed by CORS.") {

        return res.status(403).json({
            success: false,
            message: "Cross-origin request not allowed."
        });

    }

    if (error.statusCode && error.statusCode < 500) {

        return res.status(error.statusCode).json({
            success: false,
            message: error.message
        });

    }

    return res.status(500).json({
        success: false,
        message: "Internal server error."
    });

});

// ==========================================
// SERVER STARTUP
// ==========================================

async function startServer() {

    try {

        // Validate required environment variables
        if (!process.env.MONGODB_URI) {

            throw new Error(
                "MONGODB_URI environment variable is missing."
            );

        }

        if (
            !process.env.JWT_SECRET ||
            process.env.JWT_SECRET.length < 32
        ) {

            throw new Error(
                "JWT_SECRET must contain at least 32 characters."
            );

        }

        // Connect MongoDB
        console.log("Connecting to MongoDB...");

        await connectDB();

        console.log("MongoDB connection established.");

        // Start Express server
        const server = app.listen(PORT, HOST, () => {

            console.log("----------------------------------");

            console.log("JEXOLYT BACKEND STARTED");

            console.log(`Environment: ${NODE_ENV}`);

            console.log(`Host: ${HOST}`);

            console.log(`Port: ${PORT}`);

            console.log(
                `Health: http://localhost:${PORT}/api/health`
            );

            console.log("----------------------------------");

        });

        return server;

    } catch (error) {

        console.error("----------------------------------");

        console.error("JEXOLYT SERVER STARTUP FAILED");

        console.error(error.name);

        console.error(error.message);

        console.error("----------------------------------");

        process.exit(1);

    }

}

// ==========================================
// START SERVER
// ==========================================

if (require.main === module) {

    startServer();

}

// Export for testing
module.exports = {
    app,
    startServer
};