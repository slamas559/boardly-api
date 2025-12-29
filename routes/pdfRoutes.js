// routes/pdfRoutes.js
import express from "express";
import multer from "multer";
import { pdfStorage } from "../config/cloudinary.js";
import PDF from "../models/PDF.js";
import { protect } from "../utils/auth.js";
import Room from "../models/Room.js";
import dotenv from "dotenv";

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

// POST /pdf/save-state - Save PDF state (FIXED VERSION)
router.post("/save-state", protect, async (req, res) => {
  try {
    const { roomId, currentPage, annotations } = req.body;

    console.log("📝 Saving PDF state:", {
      roomId,
      currentPage,
      annotationsCount: annotations?.length || 0
    });

    // Validate room ID
    if (!roomId) {
      return res.status(400).json({ error: "Room ID is required" });
    }

    // Find room
    const room = await Room.findById(roomId);
    
    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    // Initialize pdf object if it doesn't exist
    if (!room.pdf) {
      room.pdf = {
        url: "",
        currentPage: 1,
        annotations: []
      };
    }

    // Update current page if provided
    if (currentPage !== undefined && currentPage !== null) {
      room.pdf.currentPage = currentPage;
    }

    // Update annotations if provided
    if (Array.isArray(annotations)) {
      // Filter out any annotations marked as removed
      const validAnnotations = annotations.filter(a => !a.removed);
      
      console.log("✅ Filtered annotations:", {
        received: annotations.length,
        valid: validAnnotations.length,
        removed: annotations.length - validAnnotations.length
      });
      
      room.pdf.annotations = validAnnotations;
    }

    // Mark the pdf field as modified to ensure Mongoose saves it
    room.markModified('pdf');
    
    // Save to database
    await room.save();

    console.log("✅ PDF state saved successfully");

    res.json({ 
      success: true,
      message: "PDF state saved",
      annotationsCount: room.pdf.annotations.length
    });

  } catch (error) {
    console.error("❌ Error saving PDF state:", error);
    res.status(500).json({ 
      error: "Failed to save PDF state",
      details: process.env.NODE_ENV === "development" ? error.message : undefined
    });
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