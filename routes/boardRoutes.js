import express from "express";
const router = express.Router();
import Room from "../models/Room.js";
import { protect } from "../utils/auth.js";
// GET whiteboard image for a room

router.get("/:roomId/whiteboard", async (req, res) => {
  try {
    const room = await Room.findById(req.params.roomId);
    if (!room) return res.status(404).json({ message: "Room not found" });
    return res.json({ imageData: room.whiteboardImage || null });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

// POST save whiteboard image for a room
router.post("/:roomId/whiteboard", protect, async (req, res) => {
  try {
    const { imageData } = req.body;
    if (!imageData) return res.status(400).json({ message: "No image data provided" });

    const room = await Room.findById(req.params.roomId);
    if (!room) return res.status(404).json({ message: "Room not found" });

    // Optional: verify if the user has permission to save here (e.g., isTutor check)

    room.whiteboardImage = imageData;
    await room.save();

    return res.json({ message: "Whiteboard saved" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
