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
export const activeUsers = new Map(); // userId -> {socketId, roomId, timestamp, userAgent, ip}

// New: Track active sessions per room per user
const roomUserSessions = new Map(); // `${roomId}-${userId}` -> {socketId, timestamp, userAgent, ip}

export default function socketManager(io) {
  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // Periodic cleanup for inactive users
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      const TIMEOUT = 30 * 60 * 1000; // 30 minutes
      
      for (const [userId, connection] of activeUsers.entries()) {
        if (now - connection.timestamp > TIMEOUT) {
          activeUsers.delete(userId);
          // Also cleanup room sessions
          cleanupUserFromAllRooms(userId);
        }
      }
    }, 5 * 60 * 1000); // Clean up every 5 minutes

    socket.on("join-room", async (data) => {
      try {
        const { roomId, user } = data; // Expecting {roomId, user: {id, name, isTutor}}
        
        const sessionKey = `${roomId}-${user.id}`;
        const existingRoomSession = roomUserSessions.get(sessionKey);
        const userAgent = socket.handshake.headers['user-agent'] || 'unknown';
        const userIP = socket.handshake.address || socket.conn.remoteAddress || 'unknown';
        
        // Check if user is already active in THIS specific room
        if (existingRoomSession) {
          const existingSocket = io.sockets.sockets.get(existingRoomSession.socketId);
          
          if (existingSocket && existingSocket.connected) {
            // Check if it's the same device/browser (by comparing user agent and IP)
            const isSameDevice = (
              existingRoomSession.userAgent === userAgent && 
              existingRoomSession.ip === userIP
            );
            
            if (!isSameDevice) {
              // Different device detected - disconnect the existing session
              console.log(`Multi-device access detected for user ${user.id} in room ${roomId}`);
              
              existingSocket.emit("force-disconnect", {
                reason: "Multi-device access detected",
                message: "Your session was ended because you joined this room from another device.",
                code: "MULTI_DEVICE_ACCESS"
              });
              
              // Clean up the existing session
              existingSocket.leave(roomId);
              removeUserFromRoom(existingRoomSession.socketId, roomId);
              joinedRooms.delete(existingRoomSession.socketId);
              roomUserSessions.delete(sessionKey);
              
              existingSocket.disconnect(true);
              console.log(`Previous session for user ${user.id} in room ${roomId} forcefully disconnected due to multi-device access`);
              
              // Small delay to ensure cleanup is complete
              await new Promise(resolve => setTimeout(resolve, 100));
            } else {
              // Same device - just update the socket reference
              console.log(`Same device reconnection detected for user ${user.id} in room ${roomId}`);
              
              // Clean up the previous socket reference
              if (existingRoomSession.socketId !== socket.id) {
                const oldSocket = io.sockets.sockets.get(existingRoomSession.socketId);
                if (oldSocket) {
                  oldSocket.leave(roomId);
                  removeUserFromRoom(existingRoomSession.socketId, roomId);
                  joinedRooms.delete(existingRoomSession.socketId);
                }
              }
            }
          }
        }

        // Check if socket is already in this room
        if (joinedRooms.get(socket.id) === roomId) {
          console.log(`Socket ${socket.id} already in room ${roomId}`);
          // Update timestamp for existing connection
          if (activeUsers.has(user.id)) {
            activeUsers.get(user.id).timestamp = Date.now();
          }
          if (roomUserSessions.has(sessionKey)) {
            roomUserSessions.get(sessionKey).timestamp = Date.now();
          }
          return;
        }
        
        // Leave previous room if any
        const previousRoom = joinedRooms.get(socket.id);
        if (previousRoom) {
          socket.leave(previousRoom);
          removeUserFromRoom(socket.id, previousRoom);
          // Remove from previous room session tracking
          const previousSessionKey = `${previousRoom}-${user.id}`;
          roomUserSessions.delete(previousSessionKey);
          console.log(`Socket ${socket.id} left previous room ${previousRoom}`);
        }

        // Join the new room
        socket.join(roomId);
        joinedRooms.set(socket.id, roomId);
        
        // Update global user tracking
        activeUsers.set(user.id, {
          socketId: socket.id,
          roomId,
          timestamp: Date.now(),
          userAgent,
          ip: userIP
        });

        // Update room-specific session tracking
        roomUserSessions.set(sessionKey, {
          socketId: socket.id,
          timestamp: Date.now(),
          userAgent,
          ip: userIP
        });
        
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
        socket.emit("join-room-error", {
          message: "Failed to join room. Please try again.",
          error: error.message
        });
      }
    });

    // Add heartbeat to keep sessions alive
    socket.on("heartbeat", (data) => {
      const { userId, roomId } = data;
      if (userId && roomId) {
        // Update global user tracking
        const userConnection = activeUsers.get(userId);
        if (userConnection && userConnection.socketId === socket.id) {
          userConnection.timestamp = Date.now();
        }

        // Update room session tracking
        const sessionKey = `${roomId}-${userId}`;
        const roomSession = roomUserSessions.get(sessionKey);
        if (roomSession && roomSession.socketId === socket.id) {
          roomSession.timestamp = Date.now();
        }
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

    socket.on("disconnect", (reason) => {
      console.log("User disconnected:", socket.id, "Reason:", reason);
      
      const roomId = joinedRooms.get(socket.id);
      if (roomId) {
        // Find the user associated with this socket
        const roomUserSet = roomUsers.get(roomId);
        if (roomUserSet) {
          for (const user of roomUserSet) {
            if (user.socketId === socket.id) {
              // Remove from room session tracking
              const sessionKey = `${roomId}-${user.userId}`;
              roomUserSessions.delete(sessionKey);
              
              // Remove from global tracking if this was their active session
              const globalUser = activeUsers.get(user.userId);
              if (globalUser && globalUser.socketId === socket.id) {
                activeUsers.delete(user.userId);
              }
              break;
            }
          }
        }
        
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

    // Clean up interval on server shutdown
    process.on('SIGTERM', () => {
      clearInterval(cleanupInterval);
    });
  });
}

// Helper function to clean up user from all room sessions
function cleanupUserFromAllRooms(userId) {
  const keysToDelete = [];
  for (const [sessionKey, session] of roomUserSessions.entries()) {
    if (sessionKey.endsWith(`-${userId}`)) {
      keysToDelete.push(sessionKey);
    }
  }
  keysToDelete.forEach(key => roomUserSessions.delete(key));
}

// Helper functions for room user management
function addUserToRoom(socketId, roomId, user) {
  if (!roomUsers.has(roomId)) {
    roomUsers.set(roomId, new Set());
  }

  const roomUserSet = roomUsers.get(roomId);
  // Remove any existing entry for this user first
  for (const existingUser of roomUserSet) {
    if (existingUser.userId === user.id) {
      roomUserSet.delete(existingUser);
      break;
    }
  }
  
  // Add the new entry
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
}

// Export helper functions for potential use in other modules
export { getRoomStats, broadcastRoomStats, roomUserSessions };