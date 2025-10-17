import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import roomRoutes from './routes/roomRoutes.js';
import pdfRoutes from './routes/pdfRoutes.js';
import authRoutes from './routes/authRoutes.js';
import boardRoutes from './routes/boardRoutes.js';
import paystackRoutes from './routes/paystackRoutes.js';

dotenv.config();

const app = express();

// CORS configuration for HTTP-Only cookies
app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = [
      "https://boardly-chi.vercel.app",
      "http://localhost:5173",
      "http://localhost:3000"
    ];
    
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200,
  maxAge: 86400 // 24 hours
}));

app.use(cookieParser());
app.use(express.json({
  limit: '50mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));


app.use("/rooms", roomRoutes);
app.use("/pdf", pdfRoutes);
app.use("/auth", authRoutes);
app.use("/board", boardRoutes);
app.use("/payments", paystackRoutes);

app.get('/', (req, res) => {
  res.send('API is running...');
});

export default app;