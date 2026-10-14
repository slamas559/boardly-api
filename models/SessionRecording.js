import mongoose from "mongoose";

const sessionRecordingSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  room: { type: mongoose.Schema.Types.ObjectId, ref: "Room", required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  url: { type: String, required: true },
  publicId: { type: String, required: true },
  format: { type: String, required: true, enum: ["webm", "mp4", "ogg"] },
  bytes: { type: Number, required: true, min: 1 },
  durationSeconds: { type: Number, required: true, min: 1 },
}, { timestamps: true });

const SessionRecording = mongoose.model("SessionRecording", sessionRecordingSchema);
export default SessionRecording;
