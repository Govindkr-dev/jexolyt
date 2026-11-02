const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const User = require("../models/user");
const AuditLog = require("../models/auditLog");

// ==========================================
// CREATE FIRST SUPER ADMIN
// ==========================================

const createSuperAdmin = async (req, res) => {
try {
// Check setup key
const providedKey = req.get("X-Setup-Key");
const secretKey = process.env.SUPER_ADMIN_SETUP_KEY;


    if (
        typeof providedKey !== "string" ||
        typeof secretKey !== "string" ||
        !secretKey
    ) {
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
    }).select("_id");

    if (existingSuperAdmin) {
        return res.status(403).json({
            success: false,
            message: "Super Admin setup has already been completed."
        });
    }

    // Validate input
    const {
        fullName,
        email,
        password,
        phone
    } = req.body || {};

    if (
        typeof fullName !== "string" ||
        typeof email !== "string" ||
        typeof password !== "string" ||
        !fullName.trim() ||
        !email.trim() ||
        !password
    ) {
        return res.status(400).json({
            success: false,
            message: "Full name, email and password are required."
        });
    }

    const normalizedName = fullName.trim();
    const normalizedEmail = email.trim().toLowerCase();

    if (
        normalizedName.length > 100 ||
        email.length > 254 ||
        password.length < 12 ||
        password.length > 1024 ||
        (
            phone !== undefined &&
            (
                typeof phone !== "string" ||
                phone.length > 40
            )
        )
    ) {
        return res.status(400).json({
            success: false,
            message: "Invalid input. Use a name up to 100 characters and a password between 12 and 1024 characters."
        });
    }

    const emailRegex =
        /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

    if (!emailRegex.test(normalizedEmail)) {
        return res.status(400).json({
            success: false,
            message: "Enter a valid email address."
        });
    }

    // Check duplicate email
    const existingUser = await User.findOne({
        email: normalizedEmail
    }).select("_id");

    if (existingUser) {
        return res.status(409).json({
            success: false,
            message: "An account with this email already exists."
        });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(
        password,
        12
    );

    // Create first Super Admin
    const superAdmin = await User.create({
        fullName: normalizedName,
        email: normalizedEmail,
        password: hashedPassword,
        phone: phone ? phone.trim() : null,
        role: "super_admin",
        status: "active",
        permissions: {}
    });

    // Audit logging
    try {
        await AuditLog.create({
            actor: superAdmin._id,
            actorEmail: superAdmin.email,
            action: "user.super-admin-created",
            module: "users",
            targetId: superAdmin._id.toString(),
            summary: "Created the first Super Admin account."
        });
    } catch (auditError) {
        console.error(
            "Super Admin audit logging failed:",
            auditError.name
        );
    }

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
        return res.status(403).json({
            success: false,
            message: "Super Admin setup has already been completed."
        });
    }

    console.error(
        "Super Admin setup failed:",
        error.name
    );

    return res.status(500).json({
        success: false,
        message: "Unable to create Super Admin account."
    });
}


};

module.exports = {
createSuperAdmin
};
