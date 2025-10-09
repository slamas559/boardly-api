import bcrypt from 'bcryptjs';
import User from '../../models/User.js';
import { generateToken } from '../../utils/auth.js';

// Create a test user
export const createTestUser = async (userData = {}) => {
  const defaultUser = {
    name: 'Test User',
    email: 'test@example.com',
    password: await bcrypt.hash('password123', 12),
    role: 'student',
    emailVerified: true,
    ...userData
  };

  const user = new User(defaultUser);
  await user.save();
  return user;
};

// Create a test tutor
export const createTestTutor = async (userData = {}) => {
  return createTestUser({
    name: 'Test Tutor',
    email: 'tutor@example.com',
    role: 'tutor',
    ...userData
  });
};

// Create authenticated user with token
export const createAuthenticatedUser = async (userData = {}) => {
  const user = await createTestUser(userData);
  const token = generateToken(user._id);
  return { user, token };
};

// Mock Cloudinary
export const mockCloudinary = () => {
  return {
    path: 'https://res.cloudinary.com/test/image/upload/v1234567890/test.jpg'
  };
};

// Mock Axios responses
export const mockAxiosSuccess = (data) => ({
  data: { status: true, data }
});

export const mockAxiosError = (message, status = 400) => {
  const error = new Error(message);
  error.response = { 
    data: { message },
    status 
  };
  throw error;
};

// Generate verification token
export const generateVerificationToken = () => {
  return 'test-verification-token-' + Math.random().toString(36).substring(7);
};