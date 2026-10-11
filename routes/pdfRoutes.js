// routes/pdfRoutes.js
import express from "express";
import multer from "multer";
import { pdfStorage } from "../config/cloudinary.js";
import PDF from "../models/PDF.js";
import { protect } from "../utils/auth.js";
import Room from "../models/Room.js";
import dotenv from "dotenv";
import { resetPdfState } from "../sockets/roomState.js";

dotenv.config();

const router = express.Router();
const upload = multer({ 
  storage: pdfStorage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  }
});

// POST /pdf/upload/:roomId
router.post("/upload/:roomId", protect, upload.single("pdf"), async (req, res) => {
  try {
    const { roomId } = req.params;

    // Debug logging
    console.log("Upload request received");
    console.log("Room ID:", roomId);
    console.log("File:", req.file ? { name: req.file.originalname, size: req.file.size } : "No file");
    console.log("User:", req.user._id);

    // Validate inputs
    if (!req.file) {
      return res.status(400).json({ message: "No PDF file uploaded" });
    }

    if (!roomId) {
      return res.status(400).json({ message: "Room ID is required" });
    }

    // Get PDF URL from Cloudinary
    const pdfUrl = req.file.path;
    if (!pdfUrl) {
      return res.status(400).json({ message: "Cloudinary did not return a URL" });
    }

    console.log("PDF URL:", pdfUrl);

    // Find and verify room exists
    const room = await Room.findById(roomId);
    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    // Verify user is the room creator (tutor)
    if (room.creator.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Only room creator can upload PDFs" });
    }

    // Update room with PDF
    room.pdf = {
      url: pdfUrl,
      filename: req.file.originalname,
      currentPage: 1,
      annotations: [],
      uploadedAt: new Date()
    };
    
    await room.save();
    resetPdfState(roomId, pdfUrl);

    // Also save to PDF model for reference
    await PDF.create({
      url: pdfUrl,
      filename: req.file.originalname,
      roomId,
      uploadedBy: req.user._id
    });

    console.log("PDF uploaded successfully");

    res.status(200).json({
      success: true,
      message: "PDF uploaded successfully",
      pdf: {
        url: pdfUrl,
        filename: req.file.originalname,
        currentPage: 1
      }
    });

  } catch (err) {
    console.error("Error uploading PDF:", err);
    res.status(500).json({
      message: "Failed to upload PDF",
      error: process.env.NODE_ENV === "development" ? err.message : "Server error"
    });
  }
});

// GET /pdf/state/:roomId - Get PDF state
router.get("/state/:roomId", protect, async (req, res) => {
  try {
    const { roomId } = req.params;

    const room = await Room.findById(roomId);
    
    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }
    
    res.json({
      success: true,
      currentPage: room?.pdf?.currentPage || 1,
      annotations: room?.pdf?.annotations || [],
      url: room?.pdf?.url
    });
  } catch (error) {
    console.error("Error fetching PDF state:", error);
    res.status(500).json({ error: "Failed to fetch PDF state" });
  }
});

// POST /pdf/save-state - Save the current page (annotations are persisted live by the socket layer)
router.post("/save-state", protect, async (req, res) => {
  try {
    const { roomId, currentPage } = req.body;

    if (!roomId) {
      return res.status(400).json({ error: "Room ID is required" });
    }

    const room = await Room.findById(roomId);
    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    if (room.creator.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Only the room creator can save PDF state" });
    }

    if (Number.isInteger(currentPage) && currentPage >= 1) {
      room.pdf = room.pdf || { url: "", currentPage: 1, annotations: [] };
      room.pdf.currentPage = currentPage;
      room.markModified("pdf");
      await room.save();
    }

    res.json({ success: true, message: "PDF state saved" });
  } catch (error) {
    console.error("Error saving PDF state:", error);
    res.status(500).json({ error: "Failed to save PDF state" });
  }
});

// GET /pdf/:roomId - Get PDFs for a room
router.get("/:roomId", protect, async (req, res) => {
  try {
    const pdfs = await PDF.find({ roomId: req.params.roomId });
    res.json({
      success: true,
      data: pdfs
    });
  } catch (err) {
    console.error("Error fetching PDFs:", err);
    res.status(500).json({ 
      message: "Failed to fetch PDFs",
      error: process.env.NODE_ENV === "development" ? err.message : undefined
    });
  }
});

export default router;