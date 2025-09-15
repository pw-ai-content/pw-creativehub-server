"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = require("mongoose");
const UserSchema = new mongoose_1.Schema({
    email: { type: String, required: true },
    name: { type: String },
    role: { type: String, enum: ["admin", "sme", "user"], default: "user", required: true },
    lastLoginAt: { type: Date },
}, { timestamps: true });
// Unique by email (case-insensitive)
UserSchema.index({ email: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
exports.default = (0, mongoose_1.model)("User", UserSchema);
//# sourceMappingURL=User.js.map