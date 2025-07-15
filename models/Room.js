import mongoose from "mongoose";

const roomSchema = new mongoose.Schema({
  topic: { type: String, required: true },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  code: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now },
  pdf: {
    url: { type: String },
    currentPage: { type: Number, default: 1 },
  },
});

const Room = mongoose.model("Room", roomSchema);
export default Room;
