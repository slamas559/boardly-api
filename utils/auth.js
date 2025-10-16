// utils/auth.js
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import dotenv from "dotenv";

dotenv.config();

// generate JWT
export const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "7d" });
};

// Helper to set HTTP-Only cookie
export const setTokenCookie = (res, token) => {
  res.cookie('token', token, {
    httpOnly: true, // Cannot be accessed by JavaScript
    secure: process.env.NODE_ENV === 'production', // Only HTTPS in production
    sameSite: 'lax', // CSRF protection
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    path: '/',
    domain: process.env.NODE_ENV === 'production' ? '.boardly-chi.vercel.app' : undefined 
  });
};

// Helper to clear cookie
export const clearTokenCookie = (res) => {
  res.cookie('token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
    domain: process.env.NODE_ENV === 'production' ? '.boardly-chi.vercel.app' : undefined 
  });
};

// protect middleware - now reads from cookies
export const protect = async (req, res, next) => {
  try {
    // Read token from cookie instead of Authorization header
    const token = req.cookies.token;
    
    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    // Check email verification for non-Google users
    if (!user.googleId && !user.emailVerified) {
      return res.status(403).json({ 
        message: "Please verify your email to access this feature",
        emailVerified: false
      });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ message: "Invalid token" });
  }
};