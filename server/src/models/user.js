const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        fullName: {
            type: String,
            required: true,
            trim: true,
            maxlength: 100
        },

        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
            maxlength: 254,
            match: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i
        },

        password: {
            type: String,
            required: true,
            select: false
        },

        phone: {
            type: String,
            trim: true,
            default: null
        },

        profilePicture: {
            type: String,
            default: null
        },

        role: {
            type: String,
            enum: ["super_admin", "admin"],
            default: "admin",
            required: true
        },

        status: {
            type: String,
            enum: ["active", "inactive", "suspended"],
            default: "active"
        },

        permissions: {
            type: Map,
            of: new mongoose.Schema(
                {
                    view: { type: Boolean, default: false },
                    create: { type: Boolean, default: false },
                    edit: { type: Boolean, default: false },
                    delete: { type: Boolean, default: false }
                },
                { _id: false }
            ),
            default: {}
        },

        lastLogin: {
            type: Date,
            default: null
        },

        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        }
    },
    {
        timestamps: true
    }
);

userSchema.index(
    { role: 1 },
    { unique: true, partialFilterExpression: { role: "super_admin" } }
);

module.exports = mongoose.model("User", userSchema);