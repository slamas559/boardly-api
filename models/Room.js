import mongoose from "mongoose";

const roomSchema = new mongoose.Schema({
  topic: { type: String, required: true },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  code: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now },
  
  pdf: {
    url: { type: String },
    currentPage: { type: Number, default: 1 },
    annotations: { type: Array, default: [] },
  },

  currentView: { type: String, default: "whiteboard" },
  qaEnabled: { type: Boolean, default: false },
  whiteboardImage: { type: String, default: null },
  lastActivity: { type: Date, default: Date.now },
  studentCount: { type: Number, default: 0 },
  duration: { type: Number, default: 0 }, // in minutes

  status: {
    type: String,
    enum: ["active", "inactive"],
    default: "active",
  },

  // 👇 New fields for payments
  isPaid: {
    type: Boolean,
    default: false, // free by default
  },
  price: {
    type: Number,
    default: 0, // 0 means free
  },
  currency: {
    type: String,
    default: "NGN", // or "NGN" for Paystack, etc.
  },
  participants: [
    {
      student: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      hasPaid: { type: Boolean, default: false },
      joinedAt: { type: Date, default: Date.now },
    },
  ],
});

roomSchema.methods.updateActivity = async function () {
  this.lastActivity = new Date();
  await this.save();
};

const Room = mongoose.model("Room", roomSchema);
export default Room;
