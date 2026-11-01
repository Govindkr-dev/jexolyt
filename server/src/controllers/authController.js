const User = require("../models/user");
const AuditLog = require("../models/auditLog");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const SESSION_COOKIE = "jexolyt_admin_session";
const SESSION_MAX_AGE = 8 * 60 * 60 * 1000;

function publicUser(user) {
   const permissions = user.permissions instanceof Map
       ? Object.fromEntries([...user.permissions].map(([module, actions]) => [
           module,
           actions?.toObject ? actions.toObject() : { ...actions }
       ]))
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

const login = async (req, res) => {
   try {
       const { email, password } = req.body;
       if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
           return res.status(400).json({ success: false, message: "Email and password are required." });
       }
       if (email.length > 254 || password.length > 1024) {
           return res.status(400).json({ success: false, message: "Email or password is too long." });
       }
       if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
           return res.status(503).json({ success: false, message: "Admin authentication is not configured." });
       }

       const user = await User.findOne({ email: email.toLowerCase().trim() }).select("+password");
       if (!user || user.status !== "active" || !(await bcrypt.compare(password, user.password))) {
           return res.status(401).json({ success: false, message: "Invalid email or password." });
       }

       const token = jwt.sign(
           { id: user._id.toString() },
           process.env.JWT_SECRET,
           { expiresIn: "8h", issuer: "jexolyt-admin", audience: "jexolyt-admin-panel", algorithm: "HS256" }
       );
       user.lastLogin = new Date();
       await user.save();
       await AuditLog.create({
           actor: user._id,
           actorEmail: user.email,
           action: "auth.login",
           module: "users",
           targetId: user._id.toString(),
           summary: "Admin signed in."
       });

       res.cookie(SESSION_COOKIE, token, {
           httpOnly: true,
           secure: process.env.NODE_ENV === "production",
           sameSite: "strict",
           maxAge: SESSION_MAX_AGE,
           path: "/"
       });
       return res.status(200).json({ success: true, user: publicUser(user) });
   } catch (error) {
       console.error("Admin login failed:", error.name);
       return res.status(500).json({ success: false, message: "Unable to sign in right now." });
   }
};

const logout = async (req, res, next) => {
   try {
       if (req.user) {
           await AuditLog.create({
               actor: req.user._id,
               actorEmail: req.user.email,
               action: "auth.logout",
               module: "users",
               targetId: req.user._id.toString(),
               summary: "Admin signed out."
           });
       }
   res.clearCookie(SESSION_COOKIE, {
       httpOnly: true,
       secure: process.env.NODE_ENV === "production",
       sameSite: "strict",
       path: "/"
   });
   return res.status(200).json({ success: true });
   } catch (error) {
       return next(error);
   }
};

module.exports = { login, logout, publicUser, SESSION_COOKIE };
