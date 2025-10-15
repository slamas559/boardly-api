// payment.js - Updated with split payment support
import express from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { nanoid } from 'nanoid';
import Payment from '../models/Payment.js';
import Room from '../models/Room.js';
import User from '../models/User.js';
import { protect } from '../utils/auth.js';

const router = express.Router();

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_INIT_URL = 'https://api.paystack.co/transaction/initialize';
const PAYSTACK_VERIFY_URL = 'https://api.paystack.co/transaction/verify/';

// 1) Initiate a split payment
router.post('/initiate', protect, async (req, res) => {
  try {
    const { roomId } = req.body;
    const user = req.user; // from auth middleware

    const room = await Room.findById(roomId).populate('creator');
    if (!room) return res.status(404).json({ message: 'Session not found' });

    // Check if user is the creator (tutor) - tutors get free access
    if (room.creator._id.toString() === user._id.toString()) {
      return res.json({ 
        free: true, 
        message: 'Tutor access granted - no payment required' 
      });
    }

    // If free session, immediately add participant (no payment)
    if (!room.isPaid) {
      const existingParticipant = room.participants.find(
        p => p.student.toString() === user._id.toString()
      );
      
      if (!existingParticipant) {
        room.participants.push({ 
          student: user._id, 
          hasPaid: true,
          joinedAt: new Date()
        });
        await room.save();
      }
      return res.json({ free: true, message: 'Session is free — access granted' });
    }

    // Check if student has already paid
    const existingParticipant = room.participants.find(
      p => p.student.toString() === user._id.toString() && p.hasPaid
    );
    
    if (existingParticipant) {
      return res.json({ 
        free: true, 
        message: 'You have already paid for this session' 
      });
    }

    // Check if tutor has payment setup
    if (!room.creator.paystackSubaccountCode || !room.creator.bankDetails?.isVerified) {
      return res.status(400).json({ 
        message: 'Tutor payment account not setup. Please contact support.' 
      });
    }

    const reference = `boardly_split_${nanoid(10)}`;
    const amount = Math.round(room.price * 100); // Convert to kobo

    // Create payment record with split details
    const payment = await Payment.create({
      roomId: room._id,
      studentId: user._id,
      tutorId: room.creator._id,
      amount,
      currency: room.currency || 'NGN',
      reference,
      status: 'pending',
      splitPayment: true,
      tutorSubaccount: room.creator.paystackSubaccountCode,
      splitAmounts: {
        tutorAmount: Math.round(amount * 0.7), // 70% to tutor
        platformAmount: Math.round(amount * 0.3), // 30% to platform
        tutorPercentage: 70,
        platformPercentage: 30
      }
    });

    console.log('Split payment initiated:', {
      userId: user._id,
      tutorId: room.creator._id,
      email: user.email,
      amount,
      reference,
      tutorSubaccount: room.creator.paystackSubaccountCode,
      splitAmounts: payment.splitAmounts
    });

    const callbackUrl = `${process.env.FRONTEND_URL}/payment/success?reference=${reference}`;

    // Initialize split payment with Paystack
    const transactionData = {
      email: user.email,
      amount,
      reference,
      callback_url: callbackUrl,
      subaccount: room.creator.paystackSubaccountCode,
      transaction_charge: Math.round(amount * 0.3), // Platform gets 30%
      // bearer: 'subaccount', // Subaccount bears Paystack fees
      metadata: {
        roomId: room._id.toString(),
        studentId: user._id.toString(),
        tutorId: room.creator._id.toString(),
        splitPayment: true,
        tutorEmail: room.creator.email,
        tutorName: room.creator.name,
        roomTopic: room.topic
      }
    };

    const initRes = await axios.post(PAYSTACK_INIT_URL, transactionData, {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type': 'application/json'
      }
    });

    const { authorization_url } = initRes.data.data;
    return res.json({ authorization_url, reference });

  } catch (err) {
    console.error('Paystack split payment error', err?.response?.data || err);
    return res.status(500).json({ message: 'Failed to initiate split payment' });
  }
});

// 2) Verify split payment
router.get('/verify', async (req, res) => {
  try {
    const { reference } = req.query;
    if (!reference) return res.status(400).json({ message: 'Reference required' });

    // Call paystack verify
    const verifyRes = await axios.get(`${PAYSTACK_VERIFY_URL}${reference}`, {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
      }
    });

    const paystackData = verifyRes.data.data;
    const status = paystackData.status;
    const metadata = paystackData.metadata || {};

    // Find payment record
    const payment = await Payment.findOne({ reference }).populate([
      { path: 'tutorId', select: 'name email' },
      { path: 'studentId', select: 'name email' }
    ]);

    if (!payment) {
      // Create fallback record if not exists
      const newPayment = await Payment.create({
        roomId: metadata.roomId,
        studentId: metadata.studentId,
        tutorId: metadata.tutorId,
        amount: paystackData.amount,
        currency: paystackData.currency,
        reference,
        status: status === 'success' ? 'success' : 'failed',
        splitPayment: true,
        paystackResponse: verifyRes.data
      });
      
      if (status === 'success') {
        await newPayment.processSuccess(paystackData);
      }
    } else {
      payment.status = status === 'success' ? 'success' : 'failed';
      payment.paystackResponse = verifyRes.data;
      await payment.save();
      
      if (status === 'success') {
        await payment.processSuccess(paystackData);
      }
    }

    if (status === 'success') {
      // Update room participants
      let roomData = null;
      const roomId = metadata.roomId || payment.roomId;
      const studentId = metadata.studentId || payment.studentId;
      
      if (roomId && studentId) {
        const room = await Room.findById(roomId).populate('creator', 'name email');
        if (room) {
          const existingParticipantIndex = room.participants.findIndex(
            p => p.student.toString() === studentId.toString()
          );
          
          if (existingParticipantIndex >= 0) {
            room.participants[existingParticipantIndex].hasPaid = true;
            room.participants[existingParticipantIndex].joinedAt = new Date();
          } else {
            room.participants.push({
              student: studentId,
              hasPaid: true,
              joinedAt: new Date()
            });
          }
          
          room.lastActivity = new Date();
          await room.save();
          
          roomData = {
            _id: room._id,
            topic: room.topic,
            code: room.code,
            creator: room.creator
          };
        }
      }
      
      return res.json({ 
        success: true, 
        message: 'Split payment verified successfully', 
        reference,
        roomData,
        splitInfo: {
          tutorAmount: payment.splitAmounts.tutorAmount,
          platformAmount: payment.splitAmounts.platformAmount,
          tutorPercentage: payment.splitAmounts.tutorPercentage
        }
      });
    }

    return res.status(400).json({ 
      success: false, 
      message: 'Split payment verification failed' 
    });
    
  } catch (err) {
    console.error('Split payment verification error', err?.response?.data || err);
    return res.status(500).json({ message: 'Verification failed' });
  }
});

// 3) Enhanced webhook for split payments
router.post('/webhook', async (req, res) => {
  const signature = req.headers['x-paystack-signature'] || req.headers['X-Paystack-Signature'];

  const hash = crypto.createHmac('sha512', PAYSTACK_SECRET)
    .update(req.rawBody)
    .digest('hex');

  if (hash !== signature) {
    console.warn('Invalid Paystack webhook signature');
    return res.status(400).send('invalid signature');
  }

  const event = req.body;
  
  if (event.event === 'charge.success') {
    const data = event.data;
    const reference = data.reference;
    const metadata = data.metadata || {};

    // Handle split payment webhook
    const payment = await Payment.findOne({ reference }).populate('tutorId');
    
    if (payment) {
      await payment.processSuccess(data);
      
      // Log split payment success
      console.log('Split payment webhook processed:', {
        reference,
        totalAmount: data.amount,
        tutorAmount: payment.splitAmounts.tutorAmount,
        platformAmount: payment.splitAmounts.platformAmount,
        tutorId: payment.tutorId?._id,
        subaccount: data.subaccount?.subaccount_code
      });
    } else {
      // Create new payment record from webhook
      const newPayment = await Payment.create({
        roomId: metadata.roomId,
        studentId: metadata.studentId,
        tutorId: metadata.tutorId,
        amount: data.amount,
        currency: data.currency,
        reference,
        status: 'success',
        splitPayment: true,
        tutorSubaccount: data.subaccount?.subaccount_code,
        paystackResponse: data
      });
      
      await newPayment.processSuccess(data);
    }

    // Update room participants
    if (metadata.roomId && metadata.studentId) {
      const room = await Room.findById(metadata.roomId);
      if (room) {
        const existingParticipantIndex = room.participants.findIndex(
          p => p.student.toString() === metadata.studentId.toString()
        );
        
        if (existingParticipantIndex >= 0) {
          room.participants[existingParticipantIndex].hasPaid = true;
          room.participants[existingParticipantIndex].joinedAt = new Date();
        } else {
          room.participants.push({
            student: metadata.studentId,
            hasPaid: true,
            joinedAt: new Date()
          });
        }
        
        await room.save();
      }
    }
  }

  res.sendStatus(200);
});

// Get payment records filtered by user role (student or tutor)
router.get('/', protect, async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;
    
    let query = {};
    
    // Filter payments based on user role
    if (userRole === 'student') {
      query.studentId = userId;
    } else if (userRole === 'tutor') {
      query.tutorId = userId;
    } else {
      // If role is neither student nor tutor, return empty array
      return res.json({ 
        success: true, 
        data: [],
        message: 'No payment records available for this user type'
      });
    }

    const payments = await Payment.find(query)
      .populate('roomId', 'topic code price createdAt')
      .populate('studentId', 'name email avatar')
      .populate('tutorId', 'name email avatar')
      .sort({ createdAt: -1 });
      
    // Transform payment data for frontend consumption
    const transformedPayments = payments.map(payment => {
      const basePayment = {
        _id: payment._id,
        reference: payment.reference,
        status: payment.status,
        currency: payment.currency,
        createdAt: payment.createdAt,
        room: payment.roomId ? {
          _id: payment.roomId._id,
          topic: payment.roomId.topic,
          code: payment.roomId.code,
          price: payment.roomId.price,
          createdAt: payment.roomId.createdAt
        } : null,
        student: payment.studentId ? {
          _id: payment.studentId._id,
          name: payment.studentId.name,
          email: payment.studentId.email,
          avatar: payment.studentId.avatar
        } : null,
        tutor: payment.tutorId ? {
          _id: payment.tutorId._id,
          name: payment.tutorId.name,
          email: payment.tutorId.email,
          avatar: payment.tutorId.avatar
        } : null,
        splitPayment: payment.splitPayment,
        settlement: payment.settlement
      };

      // Add role-specific payment information
      if (userRole === 'student') {
        return {
          ...basePayment,
          amount: payment.amount / 100, // Convert to naira for display
          displayAmount: payment.amount / 100,
          type: 'payment', // Student made a payment
          description: `Payment for ${payment.roomId?.topic || 'session'}`,
          recipient: payment.tutorId?.name || 'Tutor'
        };
      } else if (userRole === 'tutor') {
        return {
          ...basePayment,
          amount: payment.splitAmounts?.tutorAmount / 100 || 0, // Tutor's earnings
          totalAmount: payment.amount / 100, // Total payment amount
          platformAmount: payment.splitAmounts?.platformAmount / 100 || 0,
          displayAmount: payment.splitAmounts?.tutorAmount / 100 || 0,
          type: 'earning', // Tutor received earnings
          description: `Earnings from ${payment.roomId?.topic || 'session'}`,
          payer: payment.studentId?.name || 'Student',
          splitAmounts: {
            tutorAmount: payment.splitAmounts?.tutorAmount / 100 || 0,
            platformAmount: payment.splitAmounts?.platformAmount / 100 || 0,
            tutorPercentage: payment.splitAmounts?.tutorPercentage || 70,
            platformPercentage: payment.splitAmounts?.platformPercentage || 30
          }
        };
      }
    });

    // Calculate summary statistics
    const totalRecords = transformedPayments.length;
    const successfulPayments = transformedPayments.filter(p => p.status === 'success');
    const totalAmount = successfulPayments.reduce((sum, payment) => sum + payment.displayAmount, 0);
    
    return res.json({ 
      success: true, 
      data: transformedPayments,
      summary: {
        totalRecords,
        successfulPayments: successfulPayments.length,
        totalAmount,
        userRole,
        currency: 'NGN'
      }
    });
  } catch (err) {
    console.error('Get payments error', err);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to retrieve payment records' 
    });
  }
});

// Get payment statistics for the current user
router.get('/stats', protect, async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;
    
    let query = {};
    
    if (userRole === 'student') {
      query.studentId = userId;
    } else if (userRole === 'tutor') {
      query.tutorId = userId;
    } else {
      return res.json({ 
        success: true, 
        stats: {
          totalTransactions: 0,
          totalAmount: 0,
          successfulTransactions: 0,
          pendingTransactions: 0,
          failedTransactions: 0
        }
      });
    }

    const payments = await Payment.find(query).populate('roomId', 'topic');
    
    const successfulPayments = payments.filter(p => p.status === 'success');
    const pendingPayments = payments.filter(p => p.status === 'pending');
    const failedPayments = payments.filter(p => p.status === 'failed');
    
    let totalAmount = 0;
    
    if (userRole === 'student') {
      totalAmount = successfulPayments.reduce((sum, payment) => sum + payment.amount, 0) / 100;
    } else if (userRole === 'tutor') {
      totalAmount = successfulPayments.reduce((sum, payment) => 
        sum + (payment.splitAmounts?.tutorAmount || 0), 0) / 100;
    }

    res.json({
      success: true,
      stats: {
        totalTransactions: payments.length,
        totalAmount,
        successfulTransactions: successfulPayments.length,
        pendingTransactions: pendingPayments.length,
        failedTransactions: failedPayments.length,
        userRole,
        currency: 'NGN',
        // Additional role-specific stats
        ...(userRole === 'tutor' && {
          pendingEarnings: req.user.earnings?.pending / 100 || 0,
          totalWithdrawn: req.user.earnings?.withdrawn / 100 || 0,
          totalEarnings: req.user.earnings?.total / 100 || 0
        })
      }
    });

  } catch (error) {
    console.error('Payment stats error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch payment statistics' 
    });
  }
});

// Get single payment receipt by reference
router.get('/receipt/:reference', protect, async (req, res) => {
  try {
    const { reference } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;
    
    let query = { reference };
    
    // Ensure user can only access their own payment records
    if (userRole === 'student') {
      query.studentId = userId;
    } else if (userRole === 'tutor') {
      query.tutorId = userId;
    } else {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }

    const payment = await Payment.findOne(query)
      .populate('roomId', 'topic code price createdAt creator')
      .populate('studentId', 'name email avatar')
      .populate('tutorId', 'name email avatar');

    if (!payment) {
      return res.status(404).json({ 
        success: false, 
        message: 'Payment record not found' 
      });
    }

    // Format the receipt data
    const receipt = {
      _id: payment._id,
      reference: payment.reference,
      status: payment.status,
      currency: payment.currency,
      createdAt: payment.createdAt,
      room: payment.roomId ? {
        _id: payment.roomId._id,
        topic: payment.roomId.topic,
        code: payment.roomId.code,
        price: payment.roomId.price,
        createdAt: payment.roomId.createdAt
      } : null,
      student: payment.studentId,
      tutor: payment.tutorId,
      splitPayment: payment.splitPayment,
      settlement: payment.settlement,
      paystackResponse: payment.paystackResponse
    };

    // Add role-specific information
    if (userRole === 'student') {
      receipt.amount = payment.amount / 100;
      receipt.type = 'payment';
      receipt.description = `Payment for ${payment.roomId?.topic || 'session'}`;
    } else if (userRole === 'tutor') {
      receipt.amount = payment.splitAmounts?.tutorAmount / 100 || 0;
      receipt.totalAmount = payment.amount / 100;
      receipt.platformAmount = payment.splitAmounts?.platformAmount / 100 || 0;
      receipt.type = 'earning';
      receipt.description = `Receive for ${payment.roomId?.topic || 'session'}`;
      receipt.splitAmounts = {
        tutorAmount: payment.splitAmounts?.tutorAmount / 100 || 0,
        platformAmount: payment.splitAmounts?.platformAmount / 100 || 0,
        tutorPercentage: payment.splitAmounts?.tutorPercentage || 70,
        platformPercentage: payment.splitAmounts?.platformPercentage || 30
      };
    }

    res.json({
      success: true,
      receipt
    });

  } catch (error) {
    console.error('Get receipt error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch receipt' 
    });
  }
});
export default router;