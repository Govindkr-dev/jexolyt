const mongoose = require("mongoose");

const recordSchema = new mongoose.Schema(
    {
        module: {
            type: String,
            required: true,
            index: true
        },
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 160
        },
        data: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        },
        status: {
            type: String,
            trim: true,
            maxlength: 40,
            default: "active"
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        deletedAt: {
            type: Date,
            default: null
        },
        deletedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        }
    },
    { timestamps: true, minimize: false }
);

recordSchema.index({ module: 1, deletedAt: 1, updatedAt: -1 });

module.exports = mongoose.model("AdminRecord", recordSchema);
