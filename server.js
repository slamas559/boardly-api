import http from 'http';
import app from './app.js';
import { Server } from 'socket.io';
import connectDB from './config/db.js';
import socketManager from './sockets/index.js';
// Connect to MongoDB
connectDB();

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["https://boardly-chi.vercel.app", "http://localhost:5173"], // update with frontend URL in production
    credentials: true,
    transports: ['websocket', 'polling'] // Allow both transports
  },
  allowEIO3: true,
});

socketManager(io);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
