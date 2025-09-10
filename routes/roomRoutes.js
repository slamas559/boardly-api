// routes/roomRoutes.js
import express from "express";
import Room from "../models/Room.js";
import { protect } from "../utils/auth.js";
import Question from "../models/Question.js";

const router = express.Router();

// POST /rooms – create a new room
router.post("/", protect, async (req, res) => {
  const { topic } = req.body;
  const code = generateCode();

  const newRoom = new Room({
    topic,
    creator: req.user.id,
    code,
    lastActivity: new Date() // Set initial activity time
  });

  await newRoom.save();
  res.status(201).json({ message: "Room created", room: newRoom });
});

// GET /rooms – get all rooms for the current user
router.get("/", protect, async (req, res) => {
  const rooms = await Room.find({ creator: req.user.id }).populate("creator", "name avatar _id").sort({ createdAt: -1});
  res.json(rooms);
});

router.put("/:roomId/view", async (req, res) => {
  const { view } = req.body;
  await Room.findByIdAndUpdate(req.params.roomId, { currentView: view });
  res.sendStatus(200);
});

// PUT /rooms/:roomId – update room details
router.put("/end-room/:roomId", protect, async (req, res) => {
  try {
    // Check if user owns the room
    const { mode } = req.body;
    const room = await Room.findById(req.params.roomId);
    
    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    // Optional: Verify the user is the room creator
    if (room.creator.toString() !== req.user.id.toString()) {
      return res.status(403).json({ message: "Only the room creator can end the room" });
    }

    // Update room status
    const updatedRoom = await Room.findByIdAndUpdate(
      req.params.roomId,
      { 
        status: mode,
        endedAt: new Date() // Add timestamp for when room was ended
      },
      { new: true } // Return the updated document
    );

    res.json({ 
      message: "Room ended successfully",
      room: updatedRoom 
    });
    
    console.log("Room ended:", updatedRoom._id);

  } catch (err) {
    console.error("Error ending room:", err);
    res.status(500).json({ 
      message: 'Server error',
      error: err.message 
    });
  }
});

// DELETE /rooms/:roomId – delete a room
router.delete("/:roomId", protect, async (req, res) => {
  await Room.findByIdAndDelete(req.params.roomId);
  res.json({ message: "Room deleted" });
  console.log("Deleted room", req.params.roomId);
});

// GET /rooms/:roomId/qa-status
router.get('/:roomId/qa-status', async (req, res) => {
  try {
    const room = await Room.findById(req.params.roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    res.json({ qaEnabled: room.qaEnabled || false });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch Q&A status' });
  }
});

// PUT /rooms/:roomId/qa-status
router.put('/:roomId/qa-status', async (req, res) => {
  try {
    const { qaEnabled } = req.body;
    const room = await Room.findByIdAndUpdate(
      req.params.roomId,
      { qaEnabled },
      { new: true }
    );
    
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    res.json({ qaEnabled: room.qaEnabled });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update Q&A status' });
  }
});

// GET /rooms/:roomId/questions
router.get('/:roomId/questions', async (req, res) => {
  try {
    const questions = await Question.find({ roomId: req.params.roomId })
      .sort({ createdAt: -1 })
      //.populate('studentId', 'name');
    
    res.json({ questions });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch questions' });
  }
});

// POST /rooms/:roomId/questions
router.post('/:roomId/questions', async (req, res) => {
  try {
    const { text } = req.body;
    const question = new Question({
      roomId: req.params.roomId,
      text,
      answered: false
    });
    
    await question.save();
    // await question.populate('studentId', 'name');
    
    res.json({ question });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create question' });
  }
});

// PUT /rooms/:roomId/questions/:questionId
router.put('/:roomId/questions/:questionId', async (req, res) => {
  try {
    const { answered } = req.body;
    const question = await Question.findByIdAndUpdate(
      req.params.questionId,
      { answered },
      { new: true }
    )//.populate('studentId', 'name');
    
    if (!question) {
      return res.status(404).json({ error: 'Question not found' });
    }
    
    res.json({ question });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update question' });
  }
});

// GET /rooms/:code – fetch room by invite code
router.get("/:code", async (req, res) => {
  const room = await Room.findOne({ code: req.params.code }).populate("creator", "name avatar _id");
  if (!room) return res.status(404).json({ message: "Room not found" });

  // Update last activity when room is accessed
  await room.updateActivity();
  
  res.json(room);
});

// POST /rooms/:code/join – join a room (add participant)
router.post("/:code/join", protect, async (req, res) => {
  try {
    const room = await Room.findOne({ code: req.params.code });
    if (!room) return res.status(404).json({ message: "Room not found" });

    // Add participant if they're not the creator
    if (room.creator.toString() !== req.user.id) {
      await room.addParticipant(req.user.id);
    }

    await room.updateActivity();
    res.json({ message: "Joined room successfully", room });
  } catch (error) {
    res.status(500).json({ message: "Error joining room", error: error.message });
  }
});

// POST /rooms/:code/activity – update room activity
router.post("/:code/activity", async (req, res) => {
  try {
    const room = await Room.findOne({ code: req.params.code });
    if (!room) return res.status(404).json({ message: "Room not found" });

    await room.updateActivity();
    res.json({ message: "Activity updated", lastActivity: room.lastActivity });
  } catch (error) {
    res.status(500).json({ message: "Error updating activity", error: error.message });
  }
});

// POST /rooms/:code/track-duration – track session duration
router.post("/:code/track-duration", async (req, res) => {
  try {
    const { durationMinutes } = req.body;
    const room = await Room.findOne({ code: req.params.code });
    
    if (!room) return res.status(404).json({ message: "Room not found" });
    if (!durationMinutes || durationMinutes <= 0) {
      return res.status(400).json({ message: "Invalid duration" });
    }

    await room.trackDuration(durationMinutes);
    res.json({ 
      message: "Duration tracked", 
      totalDuration: room.duration 
    });
  } catch (error) {
    res.status(500).json({ message: "Error tracking duration", error: error.message });
  }
});

// GET /rooms/:code/participants – get room participants
router.get("/:code/participants", protect, async (req, res) => {
  try {
    const room = await Room.findOne({ code: req.params.code }).populate("participants", "name avatar email");
    
    if (!room) return res.status(404).json({ message: "Room not found" });
    if (room.creator.toString() !== req.user.id) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json({ participants: room.participants, studentCount: room.studentCount });
  } catch (error) {
    res.status(500).json({ message: "Error fetching participants", error: error.message });
  }
});

// Generate unique room code
function generateCode(length = 12) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export default router;