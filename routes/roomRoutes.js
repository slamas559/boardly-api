import express from "express";
import axios from "axios";
import crypto from "crypto";
import Room from "../models/Room.js";
import { protect } from "../utils/auth.js";
import Question from "../models/Question.js";
import { activeUsers } from "../sockets/index.js";

const router = express.Router();

// POST /rooms – create a new room (free or paid)
router.post("/", protect, async (req, res) => {
  const { topic, isPaid, price, currency } = req.body;
  const code = generateCode();

  const newRoom = new Room({
    topic,
    creator: req.user.id,
    code,
    lastActivity: new Date(),
    isPaid: isPaid || false,
    price: price || 0,
    currency: currency || "NGN",
  });

  await newRoom.save();
  res.status(201).json({ message: "Room created", room: newRoom });
});

// GET /rooms – get all rooms for the current user
router.get("/", protect, async (req, res) => {
  const rooms = await Room.find({ creator: req.user.id })
    .populate("creator", "name avatar _id")
    .sort({ createdAt: -1 });
  res.json(rooms);
});

// PUT /rooms/:roomId/view
router.put("/:roomId/view", async (req, res) => {
  const { view } = req.body;
  await Room.findByIdAndUpdate(req.params.roomId, { currentView: view });
  res.sendStatus(200);
});

// PUT /rooms/end-room/:roomId – end a room
router.put("/end-room/:roomId", protect, async (req, res) => {
  try {
    const { mode } = req.body;
    const room = await Room.findById(req.params.roomId);
    if (!room) return res.status(404).json({ message: "Room not found" });

    if (room.creator.toString() !== req.user.id.toString()) {
      return res.status(403).json({ message: "Only the room creator can end the room" });
    }

    const updatedRoom = await Room.findByIdAndUpdate(
      req.params.roomId,
      { status: mode, endedAt: new Date() },
      { new: true }
    );

    res.json({ message: "Room ended successfully", room: updatedRoom });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// DELETE /rooms/:roomId – delete a room
router.delete("/:roomId", protect, async (req, res) => {
  await Room.findByIdAndDelete(req.params.roomId);
  res.json({ message: "Room deleted" });
});

// GET /rooms/:roomId/qa-status
router.get("/:roomId/qa-status", async (req, res) => {
  try {
    const room = await Room.findById(req.params.roomId);
    if (!room) return res.status(404).json({ error: "Room not found" });
    res.json({ qaEnabled: room.qaEnabled || false });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch Q&A status" });
  }
});

// PUT /rooms/:roomId/qa-status
router.put("/:roomId/qa-status", async (req, res) => {
  try {
    const { qaEnabled } = req.body;
    const room = await Room.findByIdAndUpdate(
      req.params.roomId,
      { qaEnabled },
      { new: true }
    );
    if (!room) return res.status(404).json({ error: "Room not found" });
    res.json({ qaEnabled: room.qaEnabled });
  } catch (error) {
    res.status(500).json({ error: "Failed to update Q&A status" });
  }
});

// =======================
// 💰 PAYSTACK INTEGRATION
// =======================

// POST /rooms/:roomId/pay – initialize Paystack payment
router.post("/:roomId/pay", protect, async (req, res) => {
  try {
    const room = await Room.findById(req.params.roomId);
    if (!room) return res.status(404).json({ message: "Room not found" });

    if (!room.isPaid) {
      return res.status(400).json({ message: "This room is free, no payment needed." });
    }

    const paystackRes = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email: req.user.email,
        amount: room.price * 100, // Paystack expects amount in kobo
        currency: room.currency,
        callback_url: `${process.env.FRONTEND_URL}/payment/callback?roomId=${room._id}`,
        metadata: {
          roomId: room._id,
          studentId: req.user.id,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    res.json(paystackRes.data);
  } catch (error) {
    console.error("Paystack init error:", error.response?.data || error.message);
    res.status(500).json({ message: "Payment initialization failed" });
  }
});

// POST /rooms/paystack/webhook – Paystack callback
router.post("/paystack/webhook", express.json({ type: "application/json" }), async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    const hash = crypto
      .createHmac("sha512", secret)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (hash !== req.headers["x-paystack-signature"]) {
      return res.status(400).send("Invalid signature");
    }

    const event = req.body;
    if (event.event === "charge.success") {
      const { roomId, studentId } = event.data.metadata;

      await Room.findByIdAndUpdate(roomId, {
        $push: {
          participants: { student: studentId, hasPaid: true, joinedAt: new Date() },
        },
      });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err.message);
    res.sendStatus(500);
  }
});

// GET /rooms/:roomId/questions
router.get("/:roomId/questions", async (req, res) => {
  try {
    const questions = await Question.find({ roomId: req.params.roomId })
      .sort({ createdAt: -1 });
    res.json({ questions });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch questions" });
  }
});

// POST /rooms/:roomId/questions
router.post("/:roomId/questions", async (req, res) => {
  try {
    const { text } = req.body;
    const question = new Question({
      roomId: req.params.roomId,
      text,
      answered: false,
    });
    await question.save();
    res.json({ question });
  } catch (error) {
    res.status(500).json({ error: "Failed to create question" });
  }
});

// PUT /rooms/:roomId/questions/:questionId
router.put("/:roomId/questions/:questionId", async (req, res) => {
  try {
    const { answered } = req.body;
    const question = await Question.findByIdAndUpdate(
      req.params.questionId,
      { answered },
      { new: true }
    );
    if (!question) return res.status(404).json({ error: "Question not found" });
    res.json({ question });
  } catch (error) {
    res.status(500).json({ error: "Failed to update question" });
  }
});


router.get('/:code/public', async (req, res) => {
  try {
    const { code } = req.params;

    const room = await Room.findOne({ code })
      .populate({
        path: 'creator',
        select: 'name email role paystackSubaccountCode bankDetails',
        options: { virtuals: true } // This ensures virtuals are included
      });

    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    // Return basic room data for anonymous users
    const roomData = {
      _id: room._id,
      topic: room.topic,
      code: room.code,
      creator: room.creator,
      isPaid: room.isPaid,
      price: room.price,
      currency: room.currency,
      status: room.status,
      pdf: room.pdf,
      currentView: room.currentView,
      qaEnabled: room.qaEnabled,
      whiteboardImage: room.whiteboardImage,
      duration: room.duration,
      // For anonymous users
      hasPaid: !room.isPaid, // true for free rooms, false for paid rooms
      isTutor: false
    };

    res.json(roomData);
  } catch (error) {
    console.error('Error fetching public room:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:code', protect, async (req, res) => {
  try {
    const { code } = req.params;
    const userId = req.user._id; // from auth middleware

    // const room = req.room;
    const room = await Room.findOne({ code })
      .populate({
        path: 'creator',
        select: 'name email role paystackSubaccountCode bankDetails',
        options: { virtuals: true } // This ensures virtuals are included
      })
      .populate('participants.student', 'name email');

    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    // Check if user is the creator (tutor)
    const isTutor = room.creator._id.toString() === userId.toString();

    // Check if user has paid (for paid rooms)
    let hasPaid = false;
    if (room.isPaid) {
      // Check if user is in participants array with hasPaid = true
      const participant = room.participants.find(
        p => p.student._id.toString() === userId.toString()
      );
      hasPaid = participant ? participant.hasPaid : false;
    } else {
      // Free rooms - everyone has "paid"
      hasPaid = true;
    }

    // Return room data with payment status
    const roomData = {
      ...room.toObject(),
      hasPaid,
      isTutor
    };

    res.json(roomData);
  } catch (error) {
    console.error('Error fetching room:', error);
    res.status(500).json({ message: 'Server error' });
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
