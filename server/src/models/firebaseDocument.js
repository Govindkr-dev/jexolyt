const mongoose = require("mongoose");

const firebaseDocumentSchema = new mongoose.Schema(
    {
        sourcePath: {
            type: String,
            required: true,
            unique: true
        },
        rootCollection: {
            type: String,
            required: true,
            index: true
        },
        documentId: {
            type: String,
            required: true
        },
        data: {
            type: mongoose.Schema.Types.Mixed,
            required: true
        },
        sourceCreatedAt: {
            type: Date,
            default: null
        },
        sourceUpdatedAt: {
            type: Date,
            default: null
        },
        importedAt: {
            type: Date,
            required: true
        }
    },
    { minimize: false, collection: "firebase_documents" }
);

firebaseDocumentSchema.index({ rootCollection: 1, sourcePath: 1 }, { unique: true });

module.exports = mongoose.model("FirebaseDocument", firebaseDocumentSchema);
