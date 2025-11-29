// models/User.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    password: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Auto-remove old username_1 index (run once)
userSchema.pre("save", async function (next) {
  try {
    const indexes = await this.collection.indexes();
    const hasUsername = indexes.some((idx) => idx.key?.username);
    if (hasUsername) {
      console.log("Dropping old username_1 index...");
      await this.collection.dropIndex("username_1");
    }
    next();
  } catch (err) {
    next(err);
  }
});

// Force collection name
module.exports = mongoose.model("User", userSchema, "users");
