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
  currentView: { 
    type: String,
    default: "whiteboard" 
  },
  qaEnabled: {
    type: Boolean,
    default: false
  },
  whiteboardImage: {
    type: String, // store base64 data URL string
    default: null,
  },
  lastActivity: {
    type: Date, 
    default: Date.now 
  },
  studentCount: { 
    type: Number, 
    default: 0 
  },
  duration: { 
    type: Number, 
    default: 0 
  }, // in minutes
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }],
  status: {
    type: String,
    enum: ["active", "inactive"],
    default: "active"
  }
});

roomSchema.methods.updateActivity = function() {
  this.lastActivity = new Date();
  return this.save();
};

// Add method to increment student count
roomSchema.methods.addParticipant = function(userId) {
  if (!this.participants.includes(userId)) {
    this.participants.push(userId);
    this.studentCount = this.participants.length;
  }
  return this.save();
};

const Room = mongoose.model("Room", roomSchema);
export default Room;
