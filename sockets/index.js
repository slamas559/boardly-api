// sockets/index.js
import whiteboardEvents from "./whiteboard.js";
import pdfEvents from "./pdf.js";
import audioEvents from "./audio.js";
import chatEvents from "./chat.js";
import viewEvents from "./view.js";
import qaEvents from "./qa.js";
import Room from "../models/Room.js";

const joinedRooms = new Map();

export default function socketManager(io) {
  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join-room", async (roomId) => {
      try {
        if (joinedRooms.get(socket.id) === roomId) {
          console.log(`Socket ${socket.id} already in room ${roomId}`);
          return;
        }
        
        // Leave previous room if any
        const previousRoom = joinedRooms.get(socket.id);
        if (previousRoom) {
          socket.leave(previousRoom);
          console.log(`Socket ${socket.id} left previous room ${previousRoom}`);
        }

        socket.join(roomId);
        joinedRooms.set(socket.id, roomId);
        console.log(`Socket ${socket.id} joined room ${roomId}`);

        // Send current view to the user
        try {
          const room = await Room.findById(roomId).lean();
          if (room?.currentView) { 
            socket.emit("change-view", room.currentView);
          }
        } catch (dbError) {
          console.error("Error fetching room:", dbError);
        }

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
      joinedRooms.delete(socket.id);
    });

    // Handle connection errors
    socket.on("error", (error) => {
      console.error("Socket error:", error);
    });
  });
}