// routes/roomRoutes.js
import express from "express";
import Room from "../models/Room.js";
import { protect } from "../utils/auth.js";

const router = express.Router();

router.post("/", protect, async (req, res) => {
  const { topic } = req.body;
  const code = generateCode();

  const newRoom = new Room({
    topic,
    creator: req.user.id, // Now references User document
    code
  });

  await newRoom.save();
  res.status(201).json({ message: "Room created", room: newRoom });
});

// Generate unique room code
function generateCode(length = 6) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// POST /rooms – create a new room

// GET /rooms/:code – fetch room by invite code
router.get("/:code", async (req, res) => {
  const room = await Room.findOne({ code: req.params.code }).populate("creator", "name avatar _id");
  if (!room) return res.status(404).json({ message: "Room not found" });

  res.json(room);
});

export default router;
