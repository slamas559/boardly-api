import express from 'express';
import authRoutes from '../../routes/auth.js';

// Create test Express server
export const createTestServer = () => {
  const app = express();
  
  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  
  // Routes
  app.use('/auth', authRoutes);
  
  // Error handling middleware
  app.use((err, req, res, next) => {
    console.error('Test server error:', err);
    res.status(err.status || 500).json({
      message: err.message || 'Internal server error'
    });
  });
  
  return app;
};