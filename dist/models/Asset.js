"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/models/Asset.ts
const mongoose_1 = require("mongoose");
const ReviewSchema = new mongoose_1.Schema({
    status: {
        type: String,
        enum: ["allotted", "commented", "passed"],
    },
    assignedTo: String, // SME email (optional, if you allot)
    assignedToName: String, // SME name (optional)
    comment: String, // SME comment
    reviewedBy: String, // SME email who took action
    reviewedByName: String, // SME name who took action
    reviewedAt: Date, // when comment/passed happened
}, { _id: false });
const SMEApprovalSchema = new mongoose_1.Schema({
    status: { type: String, enum: ["yellow", "green"], default: "yellow" },
    approvedByEmail: { type: String, default: null },
    approvedAt: { type: Date, default: null },
}, { _id: false });
const AssetSchema = new mongoose_1.Schema({
    title: { type: String, required: true },
    type: {
        type: String,
        enum: ["photo", "video", "document", "vector"],
        default: "photo",
    },
    thumb: { type: String, required: true }, // <-- used by frontend
    url: { type: String }, // optional legacy/alias
    tags: { type: [String], default: [] },
    driveFileId: { type: String, index: true },
    driveFolderId: { type: String },
    driveWebViewLink: { type: String },
    driveWebContentLink: { type: String },
    mimeType: { type: String },
    uploadedBy: { type: String, index: true },
    uploaderRole: {
        type: String,
        enum: ["admin", "sme", "user"],
        default: "user",
        index: true,
    },
    createdAt: { type: Date, default: Date.now, index: true },
    downloads: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    grade: String,
    stream: String,
    subject: String,
    chapter: String,
    topic: String,
    subtopic: String,
    artStyle: String,
    version: String,
    code: String,
    folderPath: String,
    approval: {
        type: SMEApprovalSchema,
        default: { status: "yellow", approvedByEmail: null, approvedAt: null },
    },
    review: { type: ReviewSchema, default: undefined },
});
// Helpful indexes
AssetSchema.index({ "review.status": 1 });
AssetSchema.index({ "approval.status": 1 });
exports.default = mongoose_1.models.Asset || (0, mongoose_1.model)("Asset", AssetSchema);
//# sourceMappingURL=Asset.js.map