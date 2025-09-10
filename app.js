import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import roomRoutes from './routes/roomRoutes.js';
import pdfRoutes from './routes/pdfRoutes.js';
import authRoutes from './routes/authRoutes.js';
import boardRoutes from './routes/boardRoutes.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use("/rooms", roomRoutes);
app.use("/pdf", pdfRoutes);
app.use("/auth", authRoutes);
app.use("/board", boardRoutes);

app.get('/', (req, res) => {
  res.send('API is running...');
});


export default app;