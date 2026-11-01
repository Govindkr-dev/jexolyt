require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");

const connectDB = require("./src/config/db");
const authRoutes = require("./src/routes/authRoutes");
const { router: adminRoutes } = require("./src/routes/adminRoutes");
const publicRoutes = require("./src/routes/publicRoutes");

const app = express();
const siteRoot = path.resolve(__dirname, "..");
const allowedOrigins = new Set([
    "https://jexolyt.web.app",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    ...(process.env.CLIENT_URL || "").split(",").map(origin => origin.trim()).filter(Boolean)
]);

app.disable("x-powered-by");
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://www.gstatic.com", "https://apis.google.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
            connectSrc: [
                "'self'", "https://*.googleapis.com", "https://*.firebaseio.com",
                "https://*.firebaseapp.com", "https://firebasestorage.googleapis.com",
                "https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com",
                "https://firebaseinstallations.googleapis.com", "wss://*.firebaseio.com"
            ],
            frameSrc: ["'self'", "https://*.firebaseapp.com", "https://accounts.google.com", "https://www.youtube.com"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"]
        }
    }
}));

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) return callback(null, true);
        return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Setup-Key"]
}));
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));
app.use(cookieParser());
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 200,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { success: false, message: "Too many requests. Please try again later." }
}));

function requireTrustedOrigin(req, res, next) {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
        const origin = req.get("origin");
        if (!origin || !allowedOrigins.has(origin)) {
            return res.status(403).json({ success: false, message: "Requests must come from the configured website origin." });
        }
    }
    return next();
}

const staticOptions = { dotfiles: "deny", fallthrough: true, index: false, maxAge: 0 };
app.get(["/pages/dashboard.html", "/pages/dashboard"], (req, res) => {
    res.redirect(302, "/pages/admin-panel.html");
});
for (const directory of ["assets", "css", "js", "pages", "public"]) {
    app.use(`/${directory}`, express.static(path.join(siteRoot, directory), staticOptions));
}
app.get("/", (req, res) => res.sendFile(path.join(siteRoot, "index.html")));
app.get("/index.html", (req, res) => res.sendFile(path.join(siteRoot, "index.html")));
app.get("/services.html", (req, res) => res.sendFile(path.join(siteRoot, "services.html")));
app.get("/404.html", (req, res) => res.sendFile(path.join(siteRoot, "404.html")));
app.get("/style.css", (req, res) => res.sendFile(path.join(siteRoot, "style.css")));
app.get("/app.js", (req, res) => res.sendFile(path.join(siteRoot, "app.js")));

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { success: false, message: "Too many sign-in attempts. Please try again later." }
});
const setupLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 3,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { success: false, message: "Too many setup attempts. Please try again later." }
});

app.get("/api/health", (req, res) => {
    res.status(200).json({ success: true, service: "jexolyt-admin-api", version: "1.0.0" });
});
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/setup", setupLimiter);
app.use("/api/auth", requireTrustedOrigin, authRoutes);
app.use("/api/admin", requireTrustedOrigin, adminRoutes);
app.use("/api/public", publicRoutes);

app.use((req, res) => {
    res.status(404).json({ success: false, message: "Page or API endpoint not found." });
});

app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.statusCode && error.statusCode < 500) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    console.error("Request failed:", error.name);
    return res.status(500).json({ success: false, message: "The request could not be completed." });
});

async function startServer() {
    if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required.");
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
        throw new Error("JWT_SECRET must contain at least 32 characters.");
    }
    await connectDB();
    const port = Number.parseInt(process.env.PORT, 10) || 5000;
    const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
    return app.listen(port, host, () => {
        console.log(`JEXOLYT website and admin API running on port ${port}`);
    });
}

if (require.main === module) {
    startServer().catch(error => {
        console.error("Server startup failed:", error.message);
        process.exitCode = 1;
    });
}

module.exports = { app, startServer };
