import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  
  // Google OAuth fields
  googleId: { 
    type: String, 
    sparse: true, // Allows null values but ensures uniqueness when present
    unique: true 
  },
  
  role: { 
    type: String, 
    enum: ["student", "tutor"], 
    default: "student" 
  },
  avatar: { type: String }, // cloudinary image URL or Google profile picture URL
  bio: { type: String },
  
  // Email verification fields - ADD THESE
  emailVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: {
    type: String
  },
  emailVerificationExpires: {
    type: Date
  },
  // Paystack subaccount fields for split payments
  paystackSubaccountCode: { 
    type: String,
    default: null // Will be set automatically for tutors on registration
  },
  
  bankDetails: {
    bankCode: { type: String },
    accountNumber: { type: String },
    accountName: { type: String },
    isVerified: { type: Boolean, default: false }
  },
  
  // Split payment settings
  splitSettings: {
    percentage: { type: Number, default: 70 }, // Tutor gets 70%
    isActive: { type: Boolean, default: true }
  },
  
  // Earnings tracking
  earnings: {
    total: { type: Number, default: 0 }, // Total earnings in kobo
    pending: { type: Number, default: 0 }, // Pending settlement
    withdrawn: { type: Number, default: 0 } // Already withdrawn
  },
  
  createdAt: { type: Date, default: Date.now },
  },
  {
    toJSON: { virtuals: true },   // include virtuals in API responses
    toObject: { virtuals: true }, // include virtuals when converting to plain objects
  }
);

// Index for efficient Google ID lookups
userSchema.index({ googleId: 1 }, { sparse: true });

// Virtual to check if user has payment setup
userSchema.virtual('hasPaymentSetup').get(function() {
  return (this.role === 'tutor' && this.paystackSubaccountCode && this.bankDetails.isVerified);
});

// Virtual to check if user is a Google user
userSchema.virtual('isGoogleUser').get(function() {
  return !!this.googleId;
});

// Method to update earnings after successful payment
userSchema.methods.addEarnings = async function(amount) {
  const tutorShare = Math.round(amount * (this.splitSettings.percentage / 100));
  this.earnings.total += tutorShare;
  this.earnings.pending += tutorShare;
  await this.save();
  return tutorShare;
};

// Pre-save middleware to handle Google users
userSchema.pre('save', function(next) {
  // If this is a Google user and password is not set properly, generate a secure random password
  if (this.googleId && !this.password) {
    this.password = require('crypto').randomBytes(32).toString('hex');
  }
  // this.updatedAt = Date.now();
  next();
});

const User = mongoose.model("User", userSchema);
export default User;