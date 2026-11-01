const express = require("express");
const rateLimit = require("express-rate-limit");
const AdminRecord = require("../models/record");

const router = express.Router();
const contactLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { success: false, message: "Too many messages were submitted. Please try again later." }
});

router.get("/content", async (req, res, next) => {
    try {
        const homepage = await AdminRecord.findOne({
            module: "website",
            status: "published",
            "data.metadata.key": "homepage",
            deletedAt: null
        }).select("data.metadata").lean();
        const fields = homepage?.data?.metadata || {};
        const buttonUrl = typeof fields.buttonUrl === "string" ? fields.buttonUrl.trim() : "";
        const safeButtonUrl = buttonUrl.startsWith("#") || buttonUrl.startsWith("/") && !buttonUrl.startsWith("//")
            ? buttonUrl
            : /^https?:\/\//i.test(buttonUrl) ? buttonUrl : "";
        return res.json({
            success: true,
            content: {
                heroTitle: typeof fields.heroTitle === "string" ? fields.heroTitle : "",
                heroDescription: typeof fields.heroDescription === "string" ? fields.heroDescription : "",
                buttonLabel: typeof fields.buttonLabel === "string" ? fields.buttonLabel : "",
                buttonUrl: safeButtonUrl
            }
        });
    } catch (error) {
        return next(error);
    }
});

router.post("/contact", contactLimiter, async (req, res, next) => {
    try {
        if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
            return res.status(400).json({ success: false, message: "Submit a valid contact form." });
        }
        const { name, email, service, budget, message } = req.body;
        if (
            typeof name !== "string" || !name.trim() || name.trim().length > 100 ||
            typeof email !== "string" || email.length > 254 ||
            !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email.trim()) ||
            typeof message !== "string" || !message.trim() || message.trim().length > 5000 ||
            (service !== undefined && (typeof service !== "string" || service.length > 100)) ||
            (budget !== undefined && (typeof budget !== "string" || budget.length > 100))
        ) {
            return res.status(400).json({ success: false, message: "Check the required name, email, and message fields." });
        }
        await AdminRecord.create({
            module: "website",
            title: name.trim(),
            status: "new",
            data: {
                type: "contact-submission",
                name: name.trim(),
                email: email.trim().toLowerCase(),
                service: service?.trim() || "",
                budget: budget?.trim() || "",
                message: message.trim(),
                read: false
            },
            createdBy: null,
            updatedBy: null
        });
        return res.status(201).json({ success: true, message: "Message received." });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
