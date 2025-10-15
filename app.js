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
app.use(cors({
  credentials: true,
  origin: process.env.FRONTEND_URL
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
app.use("/payments", paystackRoutes)

app.get('/', (req, res) => {
  res.send('API is running...');
});


export default app;