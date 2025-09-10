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
router.post("/upload/:roomId", protect, upload.single("pdf"), async (req, res) => {
  const { roomId } = req.params;
  try {
    if (!req.file || !roomId) {
      return res.status(400).json({ message: "Missing PDF file or room ID" });
    }

    const pdfUrl = req.file.path;
    console.log(`file name: ${req.file.originalname}`);

    if (!pdfUrl) {
      return res.status(400).json({ message: "Cloudinary did not return a PDF URL" });
    }

    // Update Room with new PDF info
    const room = await Room.findById(roomId);
    if (!room) return res.status(404).json({ message: "Room not found" });

    room.pdf = {
      url: pdfUrl,
      currentPage: 1,
      annotations: [],
    };
    await room.save();

    // Save to PDF model too
    await PDF.create({
      url: pdfUrl,
      filename: req.file.originalname,
      roomId,
    });

    res.status(200).json({ message: "PDF uploaded", pdf: room.pdf });
  } catch (err) {
    console.error("Error uploading PDF:", err);
    res.status(500).json({ message: "Failed to upload PDF", error: err.message });
  }
});

// GET /pdf/state/:roomId - This should come BEFORE the generic /:roomId route
router.get("/state/:roomId", async (req, res) => {
  try {
    const room = await Room.findById(req.params.roomId);
    
    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }
    
    res.json({
      currentPage: room?.pdf?.currentPage || 1,
      annotations: room?.pdf?.annotations || [],
    });
  } catch (error) {
    console.error("Error fetching PDF state:", error);
    res.status(500).json({ error: "Failed to fetch PDF state" });
  }
});

// POST /pdf/save-state - Improved version
router.post("/save-state", async (req, res) => {
  const { roomId, currentPage, annotations } = req.body;

  try {
    // First get the current room state
    const room = await Room.findById(roomId);
    
    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    // Initialize with existing annotations or empty array
    let updatedAnnotations = room.pdf?.annotations || [];
    
    if (Array.isArray(annotations)) {
      // For each new annotation, update or add it
      annotations.forEach(newAnnotation => {
        // Check if this is a deletion request
        if (newAnnotation.removed) {
          updatedAnnotations = updatedAnnotations.filter(a => a.id !== newAnnotation.id);
          return;
        }
        
        const existingIndex = updatedAnnotations.findIndex(a => a.id === newAnnotation.id);
        
        if (existingIndex >= 0) {
          // Update existing annotation
          updatedAnnotations[existingIndex] = newAnnotation;
        } else {
          // Add new annotation with unique ID if missing
          if (!newAnnotation.id) {
            newAnnotation.id = Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
          }
          updatedAnnotations.push(newAnnotation);
        }
      });
    }

    await Room.findByIdAndUpdate(
      roomId,
      {
        $set: {
          "pdf.currentPage": currentPage,
          "pdf.annotations": annotations ?? [],
        },
      },
      { new: true }
    );

    res.json({ success: true });
  } catch (error) {
    console.error("Error saving PDF state:", error);
    res.status(500).json({ error: "Failed to save PDF state" });
  }
});

// // GET /pdf/:roomId - This should come AFTER more specific routes
// router.get("/:roomId", async (req, res) => {
//   try {
//     const pdfs = await PDF.find({ roomId: req.params.roomId });
//     res.json(pdfs);
//   } catch (err) {
//     res.status(500).json({ message: "Failed to fetch PDFs", error: err.message });
//   }
// });

export default router;