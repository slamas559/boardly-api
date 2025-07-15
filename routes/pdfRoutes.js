// routes/pdfRoutes.js
import express from "express";
import multer from "multer";
import { pdfStorage } from "../config/cloudinary.js";
import PDF from "../models/PDF.js";
import { protect } from "../utils/auth.js";
import Room from "../models/Room.js";

const router = express.Router();
const upload = multer({ storage: pdfStorage });

// POST /pdf/upload
router.post("/upload", protect, upload.single("pdf"), async (req, res) => {
  const { roomId } = req.body;

  if (!req.file || !roomId) {
    return res.status(400).json({ message: "Missing PDF file or room ID" });
  }

  const pdfUrl = req.file.path;
  // console.log(req.file)

  if (!pdfUrl) {
    return res.status(400).json({ message: "Cloudinary did not return a PDF URL" });
  }

  // Update Room with new PDF info
  const room = await Room.findById(roomId);
  if (!room) return res.status(404).json({ message: "Room not found" });

  room.pdf = {
    url: pdfUrl,
    currentPage: 1,
  };
  await room.save();

  // Save to PDF model too
  await PDF.create({
    url: pdfUrl,
    filename: req.file.originalname,
    roomId,
  });

  res.status(200).json({ message: "PDF uploaded", pdf: room.pdf });
});

// GET /pdf/:roomId
router.get("/:roomId", async (req, res) => {
  try {
    const pdfs = await PDF.find({ roomId: req.params.roomId });
    res.json(pdfs);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch PDFs", error: err.message });
  }
});

export default router;
