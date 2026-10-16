// sockets/index.js
import whiteboardEvents from "./whiteboard.js";
import pdfEvents from "./pdf.js";
import audioEvents from "./audio.js";
import chatEvents from "./chat.js";
import viewEvents from "./view.js";
import qaEvents from "./qa.js";
import activityEvents, { cleanText, releaseActivity, sendActivityState } from "./activity.js";
import recordingEvents, { isRoomRecording } from "./recording.js";
import Room from "../models/Room.js";
import jwt from "jsonwebtoken";
import { getRoomState, serializeState, releaseRoomState } from "./roomState.js";
import { markHost } from "./permissions.js";

const joinedRooms = new Map(); // socket.id -> roomId
const roomUsers = new Map(); // roomId -> Set of user objects {socketId, userId, name, isTutor}
export const activeUsers = new Map(); // userId -> {socketId, roomId, timestamp}


// Read the same HTTP-only JWT cookie the REST API uses, so the server knows who a socket is.
function readCookie(header = "", name) {
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export default function socketManager(io) {
  io.use((socket, next) => {
    try {
      const token = readCookie(socket.handshake.headers.cookie, "token");
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.data.userId = String(decoded.id);
      }
    } catch {
      // Invalid or expired token: connect as a guest (listener)
    }
    next();
  });

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join-room", async (data) => {
      try {
        const { roomId, user } = data; // Expecting {roomId, user: {id, name, isTutor}}            
        // console.log(data)
        if (joinedRooms.get(socket.id) === roomId) {
          console.log(`Socket ${socket.id} already in room ${roomId}`);
          return;
        }
        

        // Leave previous room if any
        const previousRoom = joinedRooms.get(socket.id);
        if (previousRoom) {
          socket.leave(previousRoom);
          removeUserFromRoom(socket.id, previousRoom);
          console.log(`Socket ${socket.id} left previous room ${previousRoom}`);
        }

        socket.join(roomId);
        joinedRooms.set(socket.id, roomId);

        // Who this is for class activities: a display name, and (for guests) the browser's own id so that
        // reconnecting does not let someone answer twice
        socket.data.displayName = cleanText(user?.name, 40) || "Guest";
        socket.data.clientId = typeof user?.clientId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(user.clientId) ? user.clientId : null;
        
        // Decide host status on the server: the verified user must be the room's creator
        const state = await getRoomState(roomId);
        const isHost = Boolean(state && socket.data.userId && state.creatorId === socket.data.userId);
        if (isHost) markHost(socket, roomId);

        // Add user to room tracking (isTutor is server-verified, never client-claimed)
        addUserToRoom(socket.id, roomId, { ...user, isTutor: isHost });
        console.log(`Socket ${socket.id} (${user.name}) joined room ${roomId} as ${isHost ? "host" : "listener"}`);

        // Send the full live state so late joiners see exactly what everyone else sees
        if (state) {
          socket.emit("room-state", { ...serializeState(state), isHost, isRecording: isRoomRecording(roomId) });
          socket.emit("change-view", state.view);
          sendActivityState(socket, roomId); // a question that is already running
        }

        // Broadcast updated user count to all users in the room
        broadcastRoomStats(io, roomId);

        setTimeout(() => {
          socket.emit("check-broadcast-status", { roomId });
        }, 1000);

      } catch (error) {
        console.error("Error in join-room:", error);
      }
    });

    // Initialize all socket event handlers
    whiteboardEvents(socket, io);
    pdfEvents(socket, io);
    audioEvents(socket, io);
    chatEvents(socket, io);
    viewEvents(socket, io);
    qaEvents(socket, io);
    activityEvents(socket, io);
    recordingEvents(socket, io);

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      
      const roomId = joinedRooms.get(socket.id);
      if (roomId) {
        removeUserFromRoom(socket.id, roomId);
        joinedRooms.delete(socket.id);
        
        // Broadcast updated user count to remaining users in the room
        broadcastRoomStats(io, roomId);
      }
    });

    // Handle connection errors
    socket.on("error", (error) => {
      console.error("Socket error:", error);
    });

    const cleanupInterval = setInterval(() => {
    const now = Date.now();
    const TIMEOUT = 30 * 60 * 1000; // 30 minutes timeout
    const STALE_CONNECTIONS = [];

    for (const [userId, connection] of activeUsers.entries()) {
      if (now - connection.timestamp > TIMEOUT) {
        STALE_CONNECTIONS.push(userId);
        
        // Try to disconnect the stale socket if it still exists
        const staleSocket = io.sockets.sockets.get(connection.socketId);
        if (staleSocket) {
          console.log(`Cleaning up stale connection for user ${userId}`);
          staleSocket.emit("session-timeout", {
            message: "Your session has timed out due to inactivity"
          });
          staleSocket.disconnect(true);
        }
      }
    }

    // Remove stale connections
    STALE_CONNECTIONS.forEach(userId => {
      activeUsers.delete(userId);
    });

    if (STALE_CONNECTIONS.length > 0) {
      console.log(`Cleaned up ${STALE_CONNECTIONS.length} stale connections`);
    }
  }, 5 * 60 * 1000); // Run cleanup every 5 minutes

  // Clean up interval on server shutdown
  process.on('SIGTERM', () => {
    clearInterval(cleanupInterval);
  });
  });
}


// Helper functions for room user management
function addUserToRoom(socketId, roomId, user) {
  if (!roomUsers.has(roomId)) {
    roomUsers.set(roomId, new Set());
  }

  const roomUserSet = roomUsers.get(roomId);
  roomUserSet.add({
    socketId,
    userId: user.id,
    name: user.name,
    isTutor: user.isTutor
  });
}

function removeUserFromRoom(socketId, roomId) {
  const roomUserSet = roomUsers.get(roomId);
  if (roomUserSet) {
    // Find and remove user with matching socketId
    for (const user of roomUserSet) {
      if (user.socketId === socketId) {
        roomUserSet.delete(user);
        break;
      }
    }
    
    // Clean up empty room and persist its live state
    if (roomUserSet.size === 0) {
      roomUsers.delete(roomId);
      releaseActivity(roomId);
      releaseRoomState(roomId).catch((err) => console.error("Failed to release room state:", err.message));
    }
  }
}

function checkUserInRoom(roomId, userId) {
  const roomUserSet = roomUsers.get(roomId);
  console.log(roomUserSet)
  if (!roomUserSet) return false;
  const users = Array.from(roomUserSet).some(user => user.userId === userId);
  const userName = users ? Array.from(roomUserSet).find(user => user.userId === userId).name : 'Unknown';
  // console.log(roomUserSet)
  if (users) {
    // console.log(`User already in room ${roomId}:`, userName, users);
  }
  return users;
}

function getRoomStats(roomId) {
  const roomUserSet = roomUsers.get(roomId);
  if (!roomUserSet) {
    return { totalUsers: 0, students: 0, tutors: 0 };
  }

  const users = Array.from(roomUserSet);
  const students = users.filter(user => !user.isTutor);
  const tutors = users.filter(user => user.isTutor);

  return {
    totalUsers: users.length,
    students: students.length,
    tutors: tutors.length,
    userList: users.map(user => ({
      id: user.userId,
      name: user.name,
      isTutor: user.isTutor
    }))
  };
}

function broadcastRoomStats(io, roomId) {
  const stats = getRoomStats(roomId);
  io.to(roomId).emit("room-stats-update", stats);
  // console.log(`Broadcasting stats for room ${roomId}:`, stats);
}

// Export helper functions for potential use in other modules
export { getRoomStats, broadcastRoomStats };