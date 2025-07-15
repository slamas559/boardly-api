import express from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import User from "../models/User.js";
import { generateToken } from "../utils/auth.js";
import { imageStorage } from "../config/cloudinary.js";

const router = express.Router();
const upload = multer({ imageStorage });

// POST /auth/register
router.post("/register", upload.single("avatar"), async (req, res) => {
  const { name, email, password, bio } = req.body;
  const avatar = req.file?.path;

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

export default router;
