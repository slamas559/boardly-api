import express from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import axios from "axios";
import { v2 as cloudinary } from "cloudinary";
import User from "../models/User.js";
import { generateToken, setTokenCookie, clearTokenCookie } from "../utils/auth.js";
import { imageStorage } from "../config/cloudinary.js";
import { protect } from "../utils/auth.js";
import Room from "../models/Room.js";
import { OAuth2Client } from "google-auth-library";
import passport from "passport";
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { sendVerificationEmail } from "../utils/email.js";
import 'dotenv/config';

const router = express.Router();
const upload = multer({ storage: imageStorage });

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const FRONTEND_URL = process.env.FRONTEND_URL;

// Function to create Paystack subaccount
const createPaystackSubaccount = async (userData) => {
  // console.log(`userData`, userData)
  try {
    const response = await axios.post('https://api.paystack.co/subaccount', {
      business_name: `${userData.name} - Teaching Account`,
      settlement_bank: userData.bankCode,
      account_number: userData.accountNumber,
      percentage_charge: 70,
      description: `Subaccount for tutor: ${userData.name}`,
      primary_contact_email: userData.email,
      primary_contact_name: userData.name,
      metadata: {
        userId: userData._id?.toString() || 'pending'
      }
    }, {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data.data.subaccount_code;
  } catch (error) {
    console.error('Paystack subaccount creation error:', error.response?.data || error);
    return null;
  }
};

router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

// Google callback
router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/login",
    session: false,
  }),
  (req, res) => {
    const token = req.user.generateJWT();
    setTokenCookie(res, token);
    res.redirect(`http://${FRONTEND_URL}/auth-success`);
  }
);

// POST /auth/google - Google OAuth authentication
router.post("/google", async (req, res) => {
  try {
    const { credential, role, userInfo, context } = req.body;
    
    if (!credential || !userInfo) {
      return res.status(400).json({ message: "Google credential and user info are required" });
    }

    const { email, name, picture, googleId } = userInfo;

    let user = await User.findOne({ 
      $or: [
        { email: email },
        { googleId: googleId }
      ]
    });

    if (context === 'login') {
      if (!user) {
        return res.status(404).json({ 
          message: "No account found",
          shouldRedirectToRegister: true 
        });
      }
      if (user) {
        if (!user.googleId) {
          return res.status(404).json({ message: "Type in your gmail and password please!" })
        }
        
        const token = generateToken(user._id);
        setTokenCookie(res, token);
        
        return res.json({
          success: true,
          user: {
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
          }
        });
      }
      
    } else if (context === 'register') {
      if (user) {
        return res.status(400).json({ 
          message: "Email already exists.",
          shouldRedirectToLogin: true 
        });
      }

      const hashedPassword = await bcrypt.hash(Math.random().toString(36), 12);
      user = new User({
        name,
        email,
        role,
        googleId,
        avatar: picture,
        isGoogleUser: true,
        password: hashedPassword,
      });

      await user.save();

      const token = generateToken(user._id);
      setTokenCookie(res, token);

      return res.json({
        success: true,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
        }
      });
    }

  } catch (error) {
    console.error('Google authentication error:', error);
    res.status(500).json({ message: 'Google authentication failed' });
  }
});

// POST /auth/register
router.post("/register", upload.single("avatar"), async (req, res) => {
  const { name, email, password, bio, role } = req.body;
  const avatar = req.file?.path;
  
  console.log("Registration data:", { name, email, bio, role, avatar: !!avatar });
  
  try {
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: "Email already exists" });
    }

    const hashed = await bcrypt.hash(password, 12);
    
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const user = new User({ 
      name, 
      email, 
      password: hashed, 
      bio, 
      avatar,
      role: role || 'student',
      emailVerified: false,
      emailVerificationToken: verificationToken,
      emailVerificationExpires: verificationExpires
    });
    
    await user.save();

    const emailSent = await sendVerificationEmail(email, verificationToken, name);
    
    if (!emailSent) {
      await User.findByIdAndDelete(user._id);
      return res.status(500).json({ 
        message: "Failed to send verification email. Please try again." 
      });
    }

    res.status(201).json({ 
      message: "Registration successful! Please check your email to verify your account.",
      email: email,
      verificationSent: true
    });

  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: "Registration failed. Please try again." });
  }
});

// Email verification route
router.get("/verify-email", async (req, res) => {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json({ message: "Verification token is required" });
    }

    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ 
        message: "Invalid or expired verification token" 
      });
    }

    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    const jwtToken = generateToken(user._id);
    setTokenCookie(res, jwtToken);

    res.json({
      success: true,
      message: "Email verified successfully! You can now access your account.",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        bio: user.bio,
        hasPaymentSetup: user.hasPaymentSetup,
        createdAt: user.createdAt,
        isGoogleUser: false,
        emailVerified: true
      }
    });

  } catch (error) {
    console.error("Email verification error:", error);
    res.status(500).json({ message: "Email verification failed" });
  }
});

// Resend verification email route
router.post("/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({ 
      email, 
      emailVerified: false 
    });

    if (!user) {
      return res.status(404).json({ 
        message: "User not found or already verified" 
      });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    user.emailVerificationToken = verificationToken;
    user.emailVerificationExpires = verificationExpires;
    await user.save();

    const emailSent = await sendVerificationEmail(email, verificationToken, user.name);
    
    if (!emailSent) {
      return res.status(500).json({ 
        message: "Failed to send verification email. Please try again." 
      });
    }

    res.json({ 
      message: "Verification email sent successfully!" 
    });

  } catch (error) {
    console.error("Resend verification error:", error);
    res.status(500).json({ message: "Failed to resend verification email" });
  }
});

// POST /auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    
    if (user.googleId) {
      return res.status(400).json({ 
        message: "This account uses Google Sign-In. Please use Google authentication.",
        isGoogleUser: true 
      });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: "Incorrect password" });
    }

    if (!user.googleId && !user.emailVerified) {
      return res.status(403).json({ 
        message: "Please verify your email before logging in. Check your inbox for the verification link.",
        emailVerified: false,
        email: user.email
      });
    }

    const token = generateToken(user._id);
    setTokenCookie(res, token);

    res.json({ 
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        bio: user.bio,
        hasPaymentSetup: user.hasPaymentSetup,
        earnings: user.earnings,
        createdAt: user.createdAt,
        isGoogleUser: !!user.googleId,
        emailVerified: user.emailVerified
      }
    });

  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Login failed" });
  }
});

// POST /auth/logout
router.post("/logout", (req, res) => {

  clearTokenCookie(res);
  res.json({ success: true, message: "Logged out successfully" });
});

// GET /auth/check-auth - Check if user is authenticated
router.get("/check-auth", protect, (req, res) => {
  res.json({ 
    authenticated: true,
    user: {
      _id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      avatar: req.user.avatar
    }
  });
});

// GET /auth/banks
router.get("/banks", async (req, res) => {
  try {
    const response = await axios.get('https://api.paystack.co/bank', {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`
      }
    });

    const banks = response.data.data.map(bank => ({
      name: bank.name,
      code: bank.code,
      slug: bank.slug
    }));

    res.json({ success: true, banks });
  } catch (error) {
    console.error('Error fetching banks:', error);
    res.status(500).json({ message: 'Failed to fetch banks' });
  }
});

// POST /auth/resolve-account
router.post("/resolve-account", protect, async (req, res) => {
  try {
    const { bankCode, accountNumber } = req.body;
    console.log('Resolving account:', bankCode, accountNumber);
    
    if (!bankCode || !accountNumber) {
      return res.status(400).json({ 
        success: false, 
        message: 'Bank code and account number are required' 
      });
    }

    if (accountNumber.length !== 10) {
      return res.status(400).json({ 
        success: false, 
        message: 'Account number must be 10 digits' 
      });
    }

    const response = await axios.get(
      `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`
        }
      }
    );

    if (response.data.status) {
      res.json({
        success: true,
        accountName: response.data.data.account_name
      });
      console.log('Account resolved:', response.data.data.account_name);
    } else {
      res.status(400).json({
        success: false,
        message: 'Could not resolve account details'
      });
      console.log('Account resolution failed:', response.data);
    }
  } catch (error) {
    console.error('Account resolution error:', error.response?.data || error);
    res.status(400).json({
      success: false,
      message: error.response?.data?.message || 'Invalid account details'
    });
  }
});

// POST /auth/setup-bank
router.post("/setup-bank", protect, async (req, res) => {
  try {
    const { bankCode, accountNumber } = req.body;
    const user = req.user;

    if (user.role !== 'tutor') {
      return res.status(403).json({ message: 'Only tutors can setup bank accounts' });
    }

    if (!bankCode || !accountNumber) {
      return res.status(400).json({ message: 'Bank code and account number are required' });
    }

    if (accountNumber.length !== 10) {
      return res.status(400).json({ message: 'Account number must be 10 digits' });
    }

    console.log(user.name, user.email, user._id, bankCode, accountNumber)
    
    const verifyResponse = await axios.get(
      `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`
        }
      }
    );

    if (!verifyResponse.data.status) {
      return res.status(400).json({ message: 'Invalid account details' });
    }

    const accountName = verifyResponse.data.data.account_name;

    if (user.role === 'tutor') {
      console.log('Creating Paystack subaccount for tutor...');
      const subaccountCode = await createPaystackSubaccount({
        name: user.name,
        email: user.email,
        _id: user._id,
        bankCode: bankCode,
        accountNumber: accountNumber,
      });
      
      if (subaccountCode) {
        user.paystackSubaccountCode = subaccountCode;
        console.log('Subaccount created:', subaccountCode);
      } else {
        console.log('Subaccount creation failed, but user registration continues');
        return res.status(500).json({ message: 'Failed to create payment subaccount' });
      }
    }

    user.bankDetails = {
      bankCode,
      accountNumber,
      accountName,
      isVerified: true
    };
    
    user.hasPaymentSetup = true;
    await user.save();

    res.json({
      success: true,
      message: 'Bank account setup successful',
      accountName,
      subaccountCode: user.paystackSubaccountCode
    });

  } catch (error) {
    console.error('Bank setup error:', error.response?.data || error);
    res.status(500).json({ 
      message: error.response?.data?.message || 'Failed to setup bank account' 
    });
  }
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

    const rooms = await Room.find({ creator: req.user._id });
    
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const activeRooms = rooms.filter(room => 
      room.lastActivity && new Date(room.lastActivity) > twentyFourHoursAgo
    );

    const totalStudents = rooms.reduce((total, room) => total + (room.studentCount || 0), 0);
    const totalHours = rooms.reduce((total, room) => total + (room.duration || 0), 0);

    const userData = {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      bio: user.bio,
      hasPaymentSetup: user.hasPaymentSetup,
      earnings: user.earnings,
      bankDetails: user.bankDetails,
      createdAt: user.createdAt,
      isGoogleUser: !!user.googleId,
      stats: {
        totalRooms: rooms.length,
        activeRooms: activeRooms.length,
        totalStudents: totalStudents,
        totalHours: Math.round(totalHours)
      }
    };

    res.json(userData);
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

    if (name) user.name = name;
    if (bio) user.bio = bio;

    if (req.file) {
      user.avatar = req.file.path;
    }

    if (currentPassword && newPassword && !user.googleId) {
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
        role: user.role,
        avatar: user.avatar,
        bio: user.bio,
        hasPaymentSetup: user.hasPaymentSetup,
        earnings: user.earnings,
        createdAt: user.createdAt,
        isGoogleUser: !!user.googleId
      }
    });

  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.delete("/profile", protect, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.user.id);
    clearTokenCookie(res);
    res.json({ message: "Account deleted successfully" });
  } catch (error) {
    console.error("Account deletion error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

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
      earnings: req.user.earnings,
      hasPaymentSetup: req.user.hasPaymentSetup,
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