import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import User from '../../models/User.js';
import authRoutes from '../../routes/authRoutes.js';
import { createTestUser, createAuthenticatedUser } from '../helpers/testHelpers.js';

// Create Express app for testing
const app = express();
app.use(express.json());
app.use('/auth', authRoutes);

describe('Auth Integration Tests - Simple', () => {

  describe('POST /auth/login', () => {
    test('should login with correct credentials', async () => {
      const user = await createTestUser({
        email: 'login@example.com',
        emailVerified: true
      });

      const response = await request(app)
        .post('/auth/login')
        .send({
          email: 'login@example.com',
          password: 'password123'
        });

      expect(response.status).toBe(200);
      expect(response.body.token).toBeDefined();
      expect(response.body.user.email).toBe('login@example.com');
      expect(response.body.user.password).toBeUndefined();
    });

    test('should reject unverified user', async () => {
      await createTestUser({
        email: 'unverified@example.com',
        emailVerified: false
      });

      const response = await request(app)
        .post('/auth/login')
        .send({
          email: 'unverified@example.com',
          password: 'password123'
        });

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('verify your email');
      expect(response.body.emailVerified).toBe(false);
    });

    test('should reject incorrect password', async () => {
      await createTestUser({
        email: 'user@example.com',
        emailVerified: true
      });

      const response = await request(app)
        .post('/auth/login')
        .send({
          email: 'user@example.com',
          password: 'wrongpassword'
        });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Incorrect password');
    });

    test('should reject non-existent user', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'password123'
        });

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('User not found');
    });

    test('should reject Google user trying to login with password', async () => {
      await createTestUser({
        email: 'google@example.com',
        googleId: 'google-123',
        emailVerified: true
      });

      const response = await request(app)
        .post('/auth/login')
        .send({
          email: 'google@example.com',
          password: 'password123'
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Google Sign-In');
      expect(response.body.isGoogleUser).toBe(true);
    });
  });

  describe('POST /auth/google', () => {
    test('should register new user via Google (register context)', async () => {
      const response = await request(app)
        .post('/auth/google')
        .send({
          credential: 'google-credential-token',
          role: 'student',
          context: 'register',
          userInfo: {
            email: 'newgoogle@example.com',
            name: 'Google User',
            picture: 'https://example.com/photo.jpg',
            googleId: 'google-new-123'
          }
        });

      expect(response.status).toBe(200);
      expect(response.body.token).toBeDefined();
      expect(response.body.user.email).toBe('newgoogle@example.com');

      const user = await User.findOne({ email: 'newgoogle@example.com' });
      expect(user.googleId).toBe('google-new-123');
      expect(user.isGoogleUser).toBe(true);
    });

    test('should login existing Google user (login context)', async () => {
      await createTestUser({
        email: 'existing@example.com',
        googleId: 'google-existing-123',
        emailVerified: true
      });

      const response = await request(app)
        .post('/auth/google')
        .send({
          credential: 'google-credential-token',
          context: 'login',
          userInfo: {
            email: 'existing@example.com',
            name: 'Existing User',
            googleId: 'google-existing-123'
          }
        });

      expect(response.status).toBe(200);
      expect(response.body.token).toBeDefined();
      expect(response.body.user.email).toBe('existing@example.com');
    });

    test('should reject registration if email exists (register context)', async () => {
      await createTestUser({ email: 'duplicate@example.com' });

      const response = await request(app)
        .post('/auth/google')
        .send({
          credential: 'google-credential-token',
          role: 'student',
          context: 'register',
          userInfo: {
            email: 'duplicate@example.com',
            name: 'Duplicate User',
            googleId: 'google-dup-123'
          }
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('already exists');
      expect(response.body.shouldRedirectToLogin).toBe(true);
    });

    test('should reject login if user not found (login context)', async () => {
      const response = await request(app)
        .post('/auth/google')
        .send({
          credential: 'google-credential-token',
          context: 'login',
          userInfo: {
            email: 'notfound@example.com',
            name: 'Not Found User',
            googleId: 'google-notfound-123'
          }
        });

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('No account found');
      expect(response.body.shouldRedirectToRegister).toBe(true);
    });
  });

  describe('GET /auth/profile', () => {
    test('should get user profile with stats', async () => {
      const { user, token } = await createAuthenticatedUser();

      const response = await request(app)
        .get('/auth/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.email).toBe(user.email);
      expect(response.body.stats).toBeDefined();
      expect(response.body.password).toBeUndefined();
    });

    test('should reject unauthenticated request', async () => {
      const response = await request(app).get('/auth/profile');

      expect(response.status).toBe(401);
    });
  });

  describe('PUT /auth/profile', () => {
    test('should update user profile', async () => {
      const { user, token } = await createAuthenticatedUser();

      const response = await request(app)
        .put('/auth/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Updated Name',
          bio: 'Updated bio'
        });

      expect(response.status).toBe(200);
      expect(response.body.user.name).toBe('Updated Name');
      expect(response.body.user.bio).toBe('Updated bio');

      const updatedUser = await User.findById(user._id);
      expect(updatedUser.name).toBe('Updated Name');
      expect(updatedUser.bio).toBe('Updated bio');
    });

    test('should reject incorrect current password', async () => {
      const { user, token } = await createAuthenticatedUser();

      const response = await request(app)
        .put('/auth/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: 'wrongpassword',
          newPassword: 'newpassword123'
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Current password is incorrect');
    });
  });

  describe('DELETE /auth/profile', () => {
    test('should delete user account', async () => {
      const { user, token } = await createAuthenticatedUser();

      const response = await request(app)
        .delete('/auth/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('deleted successfully');

      const deletedUser = await User.findById(user._id);
      expect(deletedUser).toBeNull();
    });

    test('should reject unauthenticated deletion', async () => {
      const response = await request(app).delete('/auth/profile');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /auth/stats', () => {
    test('should get user statistics', async () => {
      const { user, token } = await createAuthenticatedUser({ role: 'tutor' });

      const response = await request(app)
        .get('/auth/stats')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.totalRooms).toBeDefined();
      expect(response.body.activeRooms).toBeDefined();
      expect(response.body.totalStudents).toBeDefined();
      expect(response.body.totalHours).toBeDefined();
      expect(response.body.earnings).toBeDefined();
      expect(response.body.hasPaymentSetup).toBeDefined();
      expect(response.body.rooms).toBeInstanceOf(Array);
    });

    test('should reject unauthenticated stats request', async () => {
      const response = await request(app).get('/auth/stats');

      expect(response.status).toBe(401);
    });
  });
});