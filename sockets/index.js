// sockets/index.js
import whiteboardEvents from "./whiteboard.js";
import pdfEvents from "./pdf.js";
import audioEvents from "./audio.js";
import chatEvents from "./chat.js";
import viewEvents from "./view.js";
import qaEvents from "./qa.js";
import Room from "../models/Room.js";

const joinedRooms = new Map(); // socket.id -> roomId
const roomUsers = new Map(); // roomId -> Set of user objects {socketId, userId, name, isTutor}
export const activeUsers = new Map(); // userId -> {socketId, roomId, timestamp}


export default function socketManager(io) {
  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join-room", async (data) => {
      try {
        const { roomId, user } = data; // Expecting {roomId, user: {id, name, isTutor}}            

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
        
        // Add user to room tracking
        addUserToRoom(socket.id, roomId, user);
        console.log(`Socket ${socket.id} (${user.name}) joined room ${roomId}`);

        // Send current view to the user
        try {
          const room = await Room.findById(roomId).lean();
          if (room?.currentView) { 
            socket.emit("change-view", room.currentView);
          }
        } catch (dbError) {
          console.error("Error fetching room:", dbError);
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

    socket.on("tutor-cursor-move", (cursorData) => {
      socket.to(cursorData.room).emit("tutor-cursor-move", cursorData);
    });

    socket.on("tutor-cursor-move-pdf", (cursorData) => {
      socket.to(cursorData.room).emit("tutor-cursor-move-pdf", cursorData);
    });

    // Initialize all socket event handlers
    whiteboardEvents(socket, io);
    pdfEvents(socket, io);
    audioEvents(socket, io);
    chatEvents(socket, io);
    viewEvents(socket, io);
    qaEvents(socket, io);

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
    
    // Clean up empty room
    if (roomUserSet.size === 0) {
      roomUsers.delete(roomId);
    }
  }
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