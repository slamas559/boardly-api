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
import { markHost, participantKey, releaseAccess } from "./permissions.js";
import accessEvents, { sendAccess } from "./access.js";

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

  // Drop sockets that have been idle too long. This runs once for the whole server (it used to be started again
  // for every connection, which piled up timers and shutdown listeners).
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
  cleanupInterval.unref?.(); // never keep the process (or a test run) alive just for this timer

  // Clean up interval on server shutdown
  process.once('SIGTERM', () => {
    clearInterval(cleanupInterval);
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
        addUserToRoom(socket.id, roomId, { ...user, isTutor: isHost }, participantKey(socket));
        console.log(`Socket ${socket.id} (${user.name}) joined room ${roomId} as ${isHost ? "host" : "listener"}`);

        // Send the full live state so late joiners see exactly what everyone else sees
        if (state) {
          socket.emit("room-state", { ...serializeState(state), isHost, isRecording: isRoomRecording(roomId), participantKey: participantKey(socket) });
          sendAccess(socket, roomId); // what the host has let listeners do
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
    accessEvents(socket, io);

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
  });
}


// Helper functions for room user management
function addUserToRoom(socketId, roomId, user, key) {
  if (!roomUsers.has(roomId)) {
    roomUsers.set(roomId, new Set());
  }

  const roomUserSet = roomUsers.get(roomId);
  roomUserSet.add({
    socketId,
    key,
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
      releaseAccess(roomId);
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

// Up to this many people, everyone sees the list of names; in a bigger room only the host receives it
const OPEN_ROSTER_LIMIT = 50;
const ROSTER_CAP = 2000;

function getRoomStats(roomId) {
  const roomUserSet = roomUsers.get(roomId);
  if (!roomUserSet) {
    return { totalUsers: 0, students: 0, tutors: 0, userList: [] };
  }

  const users = Array.from(roomUserSet);
  const tutors = users.filter(user => user.isTutor).length;

  return {
    totalUsers: users.length,
    students: users.length - tutors,
    tutors,
    userList: users.slice(0, ROSTER_CAP).map(user => ({
      key: user.key,
      id: user.userId,
      name: user.name,
      isTutor: user.isTutor
    }))
  };
}

// Joins and leaves arrive in bursts in a big room, so the update goes out at most a few times a second
const pendingStats = new Set();
function broadcastRoomStats(io, roomId) {
  if (pendingStats.has(roomId)) return;
  pendingStats.add(roomId);
  setTimeout(() => {
    pendingStats.delete(roomId);
    const stats = getRoomStats(roomId);
    const { userList, ...counts } = stats;
    io.to(roomId).emit("room-stats-update", stats.totalUsers <= OPEN_ROSTER_LIMIT ? stats : counts);
    // The host always gets the full list, which is what the permissions panel is built from
    for (const user of roomUsers.get(roomId) || []) {
      if (user.isTutor) io.to(user.socketId).emit("room-roster", { userList });
    }
  }, 400);
}

// Export helper functions for potential use in other modules
export { getRoomStats, broadcastRoomStats };