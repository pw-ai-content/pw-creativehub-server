import { Schema, model } from "mongoose";
import type { Role } from "../middleware/auth";

const UserSchema = new Schema(
  {
    email: { type: String, required: true },
    name: { type: String },
    role: { type: String, enum: ["admin", "sme", "user"], default: "user", required: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

// Unique by email (case-insensitive)
UserSchema.index({ email: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });

export type TUser = {
  _id: string;
  email: string;
  name?: string;
  role: Role;
};

export default model("User", UserSchema);
