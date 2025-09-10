import express from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import User from "../models/User.js";
import { generateToken } from "../utils/auth.js";
import { imageStorage } from "../config/cloudinary.js";
import { protect } from "../utils/auth.js";
import Room from "../models/Room.js";

const router = express.Router();
const upload = multer({ storage: imageStorage });

// POST /auth/register
router.post("/register", upload.single("avatar"), async (req, res) => {
  const { name, email, password, bio } = req.body;
  const avatar = req.file?.path;
  
  console.log("Extracted data:", { name, email, bio, avatar: !!avatar });
  const existing = await User.findOne({ email });
  if (existing) return res.status(400).json({ message: "Email already exists" });

  const hashed = await bcrypt.hash(password, 12);
  const user = new User({ name, email, password: hashed, bio, avatar });
  await user.save();

  res.status(201).json({ token: generateToken(user._id), user });
});

// POST /auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });

  if (!user) return res.status(404).json({ message: "User not found" });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ message: "Incorrect password" });

  res.json({ token: generateToken(user._id), user });
});

router.get("/", async (req, res) => {
  const users = await User.find();
  res.json(users)
});

router.get("/profile", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Get user's rooms to calculate stats
    const rooms = await Room.find({ creator: req.user._id });
    
    // Calculate active rooms (rooms with activity in last 24 hours)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const activeRooms = rooms.filter(room => 
      room.lastActivity && new Date(room.lastActivity) > twentyFourHoursAgo
    );

    // Calculate total students (you might want to track this differently)
    // For now, we'll use a mock calculation
    const totalStudents = rooms.reduce((total, room) => total + (room.studentCount || 0), 0);

    // Calculate total teaching hours (mock data - you should track this properly)
    const totalHours = rooms.reduce((total, room) => total + (room.duration || 0), 0);

    // Prepare user data with stats
    const userData = {
      _id: user._id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      bio: user.bio,
      createdAt: user.createdAt,
      stats: {
        totalRooms: rooms.length,
        activeRooms: activeRooms.length,
        totalStudents: totalStudents,
        totalHours: Math.round(totalHours)
      }
    };

    res.json(user);
  } catch (error) {
    console.error("Error fetching user data:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.put("/profile", protect, upload.single("avatar"), async (req, res) => {
  try {
    const { name, bio, currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Update basic info
    if (name) user.name = name;
    if (bio) user.bio = bio;

    // Update avatar if provided
    if (req.file) {
      user.avatar = req.file.path;
    }

    // Update password if current password is provided
    if (currentPassword && newPassword) {
      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res.status(400).json({ message: "Current password is incorrect" });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ message: "New password must be at least 6 characters" });
      }
      user.password = await bcrypt.hash(newPassword, 12);
    }

    await user.save();

    res.json({
      message: "Profile updated successfully",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        bio: user.bio,
        createdAt: user.createdAt
      }
    });

  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// DELETE /auth/profile - Delete user account
router.delete("/profile", protect, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.user.id);
    res.json({ message: "Account deleted successfully" });
  } catch (error) {
    console.error("Account deletion error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /auth/stats - Get detailed user statistics (optional)
router.get("/stats", protect, async (req, res) => {
  try {
    const rooms = await Room.find({ creator: req.user._id });
    
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const activeRooms = rooms.filter(room => 
      room.lastActivity && new Date(room.lastActivity) > twentyFourHoursAgo
    );

    const totalStudents = rooms.reduce((total, room) => total + (room.studentCount || 0), 0);
    const totalHours = rooms.reduce((total, room) => total + (room.duration || 0), 0);

    res.json({
      totalRooms: rooms.length,
      activeRooms: activeRooms.length,
      totalStudents: totalStudents,
      totalHours: Math.round(totalHours),
      rooms: rooms.map(room => ({
        _id: room._id,
        topic: room.topic,
        code: room.code,
        createdAt: room.createdAt,
        lastActivity: room.lastActivity,
        studentCount: room.studentCount || 0,
        duration: room.duration || 0
      }))
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
