const express = require("express");
const router = express.Router();

const { login, logout, refresh, publicUser } = require("../controllers/authController");
const { protect, optionalUser } = require("../middleware/authMiddleware");
const { createSuperAdmin } = require("../controllers/setupController");
const User = require("../models/user");

router.post("/login", login);
router.post("/refresh", refresh);
router.post("/setup", createSuperAdmin);
router.post("/logout", optionalUser, logout);
router.get("/setup/status", async (req, res, next) => {
    try {
        const initialized = await User.exists({ role: "super_admin" });
        return res.json({ success: true, available: !initialized });
    } catch (error) {
        return next(error);
    }
});

router.get("/me", protect, (req, res) => {
    res.status(200).json({ success: true, user: publicUser(req.user) });
});

module.exports = router;