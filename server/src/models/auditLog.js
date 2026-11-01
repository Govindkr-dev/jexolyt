const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
    {
        actor: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        actorEmail: {
            type: String,
            required: true,
            maxlength: 254
        },
        action: {
            type: String,
            required: true,
            maxlength: 80
        },
        module: {
            type: String,
            required: true,
            maxlength: 60
        },
        targetId: {
            type: String,
            default: null,
            maxlength: 100
        },
        summary: {
            type: String,
            required: true,
            maxlength: 500
        }
    },
    { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
