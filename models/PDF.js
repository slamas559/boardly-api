// models/PDF.js
import mongoose from "mongoose";

const pdfSchema = new mongoose.Schema({
  url: { type: String, required: true },
  filename: { type: String, required: true },
  roomId: { type: mongoose.Schema.Types.ObjectId, ref: "Room" },
  uploadedAt: { type: Date, default: Date.now }
});

const PDF = mongoose.model("PDF", pdfSchema);

export default PDF;
