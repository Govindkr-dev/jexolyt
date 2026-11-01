const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/user");
const AuditLog = require("../models/auditLog");

// CREATE FIRST SUPER ADMIN
const createSuperAdmin = async (req, res) => {
    try {
        const { fullName, email, password, phone } = req.body;

        // Verify setup key
        const providedKey = req.headers["x-setup-key"];
        const secretKey = process.env.SUPER_ADMIN_SETUP_KEY;

        if (!secretKey || !providedKey) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized setup request."
            });
        }

        const providedBuffer = Buffer.from(providedKey);
        const secretBuffer = Buffer.from(secretKey);

        if (
            providedBuffer.length !== secretBuffer.length ||
            !crypto.timingSafeEqual(providedBuffer, secretBuffer)
        ) {
            return res.status(401).json({
                success: false,
                message: "Invalid setup credentials."
            });
        }

        // Check whether Super Admin already exists
        const existingSuperAdmin = await User.findOne({
            role: "super_admin"
        });

        if (existingSuperAdmin) {
            return res.status(403).json({
                success: false,
                message: "Super Admin account already exists."
            });
        }

        // Validate input
        if (
            typeof fullName !== "string" || typeof email !== "string" || typeof password !== "string" ||
            !fullName.trim() || !email.trim() || !password
        ) {
            return res.status(400).json({
                success: false,
                message: "Full name, email and password are required."
            });
        }

        if (
            fullName.trim().length > 100 || email.length > 254 ||
            password.length < 12 || password.length > 1024 ||
            (phone !== undefined && (typeof phone !== "string" || phone.length > 40))
        ) {
            return res.status(400).json({
                success: false,
                message: "Use a name of at most 100 characters, a valid email, and a password of 12–1,024 characters."
            });
        }

        const normalizedEmail = email.trim().toLowerCase();
        if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(normalizedEmail)) {
            return res.status(400).json({ success: false, message: "Enter a valid email address." });
        }

        const existingUser = await User.findOne({
            email: normalizedEmail
        });

        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: "An account with this email already exists."
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 12);

        // Create Super Admin
        const superAdmin = await User.create({
            fullName: fullName.trim(),
            email: normalizedEmail,
            password: hashedPassword,
            phone: phone || null,
            role: "super_admin",
            status: "active",
            permissions: {}
        });
        await AuditLog.create({
            actor: superAdmin._id,
            actorEmail: superAdmin.email,
            action: "user.super-admin-created",
            module: "users",
            targetId: superAdmin._id.toString(),
            summary: "Created the first Super Admin account."
        });

        return res.status(201).json({
            success: true,
            message: "Super Admin account created successfully.",
            user: {
                id: superAdmin._id,
                fullName: superAdmin.fullName,
                email: superAdmin.email,
                role: superAdmin.role,
                status: superAdmin.status
            }
        });

    } catch (error) {
        if (error.code === 11000) {
            return res.status(403).json({ success: false, message: "Super Admin setup has already been completed." });
        }
        console.error("Super Admin setup failed:", error.name);

        return res.status(500).json({
            success: false,
            message: "Unable to create Super Admin account."
        });
    }
};

module.exports = {
    createSuperAdmin
};