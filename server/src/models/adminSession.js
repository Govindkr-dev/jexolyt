const mongoose = require("mongoose");

const adminSessionSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        refreshTokenHash: {
            type: String,
            required: true,
            unique: true,
            select: false
        },
        familyId: {
            type: String,
            required: true,
            index: true
        },
        expiresAt: {
            type: Date,
            required: true
        },
        revokedAt: {
            type: Date,
            default: null
        },
        replacedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminSession",
            default: null
        }
    },
    { timestamps: true }
);

adminSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
adminSessionSchema.index({ userId: 1, revokedAt: 1, expiresAt: 1 });

module.exports = mongoose.model("AdminSession", adminSessionSchema);
