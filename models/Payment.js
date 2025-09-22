import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tutorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Added for split tracking
  
  amount: { type: Number, required: true },      // Total amount in kobo
  currency: { type: String, default: 'NGN' },
  reference: { type: String, required: true, unique: true },
  status: { type: String, enum: ['pending','success','failed'], default: 'pending' },
  
  // 👇 Split payment fields
  splitPayment: { type: Boolean, default: true }, // All payments are now split
  tutorSubaccount: { type: String }, // Tutor's Paystack subaccount code
  
  // Split amounts (calculated automatically)
  splitAmounts: {
    tutorAmount: { type: Number }, // Amount for tutor (70%)
    platformAmount: { type: Number }, // Amount for platform (30%)
    tutorPercentage: { type: Number, default: 70 },
    platformPercentage: { type: Number, default: 30 }
  },
  
  // Settlement tracking
  settlement: {
    tutorSettled: { type: Boolean, default: false },
    platformSettled: { type: Boolean, default: false },
    settlementDate: { type: Date }
  },
  
  paystackResponse: { type: Object }, // Full Paystack response
  splitInfo: { type: Object }, // Split-specific data from Paystack
  
  createdAt: { type: Date, default: Date.now }
});

// Pre-save middleware to calculate split amounts
paymentSchema.pre('save', function(next) {
  if (this.isModified('amount') || this.isNew) {
    const tutorPercentage = this.splitAmounts?.tutorPercentage || 70;
    const platformPercentage = this.splitAmounts?.platformPercentage || 30;
    
    this.splitAmounts = {
      tutorAmount: Math.round((this.amount * tutorPercentage) / 100),
      platformAmount: Math.round((this.amount * platformPercentage) / 100),
      tutorPercentage,
      platformPercentage
    };
  }
  next();
});

// Method to process successful split payment
paymentSchema.methods.processSuccess = async function(paystackData) {
  this.status = 'success';
  this.paystackResponse = paystackData;
  
  // Handle split information
  if (paystackData.subaccount) {
    this.splitInfo = {
      subaccount: paystackData.subaccount,
      transaction_charge: paystackData.transaction_charge
    };
  }
  
  await this.save();
  
  // Update tutor earnings
  if (this.tutorId) {
    const User = mongoose.model('User');
    const tutor = await User.findById(this.tutorId);
    if (tutor) {
      await tutor.addEarnings(this.amount);
    }
  }
};

export default mongoose.model('Payment', paymentSchema);