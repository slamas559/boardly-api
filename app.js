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
  origin: ["https://boardly-chi.vercel.app", "http://localhost:5173"],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200
}));

app.use(cookieParser());
app.use(express.json({
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