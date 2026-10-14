import { jest } from '@jest/globals';
import bcrypt from 'bcryptjs';
import User from '../../models/User.js';
import { createTestUser, generateVerificationToken } from '../helpers/testHelpers.js';
import { generateToken } from '../../utils/auth.js';

describe('Auth Unit Tests', () => {
  
  describe('User Model', () => {
    test('should create a user successfully', async () => {
      const userData = {
        name: 'John Doe',
        email: 'john@example.com',
        password: await bcrypt.hash('password123', 12),
        emailVerified: true
      };

      const user = new User(userData);
      await user.save();

      expect(user._id).toBeDefined();
      expect(user.name).toBe('John Doe');
      expect(user.email).toBe('john@example.com');
      expect(user.role).toBeUndefined();
      expect(user.emailVerified).toBe(true);
    });

    test('should not create user with duplicate email', async () => {
      await createTestUser({ email: 'duplicate@example.com' });

      const duplicateUser = new User({
        name: 'Another User',
        email: 'duplicate@example.com',
        password: await bcrypt.hash('password123', 12)
      });

      await expect(duplicateUser.save()).rejects.toThrow();
    });

    test('should require email field', async () => {
      const user = new User({
        name: 'No Email User',
        password: 'password123'
      });

      await expect(user.save()).rejects.toThrow();
    });

    test('should not assign an account role', async () => {
      const user = new User({
        name: 'Default Role User',
        email: 'default@example.com',
        password: await bcrypt.hash('password123', 12)
      });

      await user.save();
      expect(user.role).toBeUndefined();
    });
  });

  describe('Password Hashing', () => {
    test('should hash password correctly', async () => {
      const plainPassword = 'mySecurePassword123';
      const hashedPassword = await bcrypt.hash(plainPassword, 12);

      expect(hashedPassword).not.toBe(plainPassword);
      expect(hashedPassword.length).toBeGreaterThan(50);
    });

    test('should verify correct password', async () => {
      const plainPassword = 'correctPassword';
      const hashedPassword = await bcrypt.hash(plainPassword, 12);

      const isMatch = await bcrypt.compare(plainPassword, hashedPassword);
      expect(isMatch).toBe(true);
    });

    test('should reject incorrect password', async () => {
      const plainPassword = 'correctPassword';
      const hashedPassword = await bcrypt.hash(plainPassword, 12);

      const isMatch = await bcrypt.compare('wrongPassword', hashedPassword);
      expect(isMatch).toBe(false);
    });
  });

  describe('Token Generation', () => {
    test('should generate valid JWT token', () => {
      const userId = '507f1f77bcf86cd799439011';
      const token = generateToken(userId);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3); // JWT has 3 parts
    });
  });

  describe('Email Verification', () => {
    test('should create user with verification token', async () => {
      const verificationToken = generateVerificationToken();
      const user = await createTestUser({
        emailVerified: false,
        emailVerificationToken: verificationToken,
        emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000)
      });

      expect(user.emailVerified).toBe(false);
      expect(user.emailVerificationToken).toBe(verificationToken);
      expect(user.emailVerificationExpires).toBeDefined();
    });

    test('should verify email and clear token', async () => {
      const verificationToken = generateVerificationToken();
      const user = await createTestUser({
        emailVerified: false,
        emailVerificationToken: verificationToken,
        emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000)
      });

      user.emailVerified = true;
      user.emailVerificationToken = undefined;
      user.emailVerificationExpires = undefined;
      await user.save();

      const updatedUser = await User.findById(user._id);
      expect(updatedUser.emailVerified).toBe(true);
      expect(updatedUser.emailVerificationToken).toBeUndefined();
      expect(updatedUser.emailVerificationExpires).toBeUndefined();
    });
  });

  describe('Google User Authentication', () => {
    test('should create Google user with googleId', async () => {
      const user = await createTestUser({
        googleId: 'google-123456',
        isGoogleUser: true,
        emailVerified: true
      });

      expect(user.googleId).toBe('google-123456');
      expect(user.isGoogleUser).toBe(true);
    });

    test('should find user by googleId', async () => {
      await createTestUser({
        email: 'google@example.com',
        googleId: 'google-unique-id',
        isGoogleUser: true
      });

      const foundUser = await User.findOne({ googleId: 'google-unique-id' });
      expect(foundUser).toBeDefined();
      expect(foundUser.email).toBe('google@example.com');
    });
  });

  describe('Bank Details', () => {
    test('should add bank details to any user', async () => {
      const user = await createTestUser({ hasPaymentSetup: false });

      user.paystackSubaccountCode = 'ACCT_test123456';
      user.bankDetails = {
        bankCode: '058',
        accountNumber: '0123456789',
        accountName: 'Test User',
        isVerified: true
      };
      await user.save();

      const updatedUser = await User.findById(user._id);
      expect(updatedUser.bankDetails.bankCode).toBe('058');
      expect(updatedUser.bankDetails.accountNumber).toBe('0123456789');
      expect(updatedUser.hasPaymentSetup).toBe(true);
    });

    test('should store paystack subaccount code', async () => {
      const user = await createTestUser();

      user.paystackSubaccountCode = 'ACCT_test123456';
      await user.save();

      const updatedUser = await User.findById(user._id);
      expect(updatedUser.paystackSubaccountCode).toBe('ACCT_test123456');
    });
  });

  describe('User Query Operations', () => {
    test('should find user by email or googleId', async () => {
      const user = await createTestUser({
        email: 'multi@example.com',
        googleId: 'google-multi-123'
      });

      const foundByEmail = await User.findOne({ email: 'multi@example.com' });
      const foundByGoogleId = await User.findOne({ googleId: 'google-multi-123' });

      expect(foundByEmail._id.toString()).toBe(user._id.toString());
      expect(foundByGoogleId._id.toString()).toBe(user._id.toString());
    });

    test('should exclude password when selecting user', async () => {
      const user = await createTestUser();
      
      const userWithoutPassword = await User.findById(user._id).select('-password');
      
      expect(userWithoutPassword.password).toBeUndefined();
      expect(userWithoutPassword.email).toBeDefined();
    });
  });
});