// sockets/voice.js

// Store active voice broadcasts by room
const activeBroadcasts = new Map(); // roomId -> { tutorSocketId, isActive: boolean }

export default function voiceEvents(socket, io) {
  
  // Handle voice broadcast started by tutor
  socket.on('voice-broadcast-started', (data) => {
    const { roomId } = data;
    console.log(`Voice broadcast started by tutor in room: ${roomId}`);
    
    // Mark broadcast as active for this room
    activeBroadcasts.set(roomId, {
      tutorSocketId: socket.id,
      isActive: true
    });
    
    // Notify all students in the room that broadcast has started
    socket.to(roomId).emit('voice-broadcast-started', {
      roomId,
      tutorSocketId: socket.id
    });
  });
  
  // Handle voice offer from tutor to students
  socket.on('voice-offer', (data) => {
    const { roomId, offer, targetStudentId } = data;
    console.log(`Voice offer from tutor in room: ${roomId}`, targetStudentId ? `for student: ${targetStudentId}` : 'for all students');
    
    if (targetStudentId) {
      // Send offer to specific student
      const studentSocket = io.sockets.sockets.get(targetStudentId);
      if (studentSocket) {
        studentSocket.emit('voice-offer', {
          roomId,
          offer,
          tutorSocketId: socket.id
        });
        console.log(`Sent targeted offer to student: ${targetStudentId}`);
      }
    } else {
      // Broadcast the offer to all students in the room (excluding the tutor)
      socket.to(roomId).emit('voice-offer', {
        roomId,
        offer,
        tutorSocketId: socket.id
      });
    }
  });

  // Handle student requesting to join broadcast
  socket.on('student-join-broadcast', (data) => {
    const { roomId, studentSocketId } = data;
    console.log(`Student ${studentSocketId} requesting to join broadcast in room: ${roomId}`);
    
    // Find the tutor and tell them to create a connection for this student
    const activeBroadcast = activeBroadcasts.get(roomId);
    if (activeBroadcast && activeBroadcast.isActive) {
      const tutorSocket = io.sockets.sockets.get(activeBroadcast.tutorSocketId);
      if (tutorSocket) {
        tutorSocket.emit('student-join-broadcast', {
          roomId,
          studentSocketId
        });
        console.log(`Notified tutor to create connection for student: ${studentSocketId}`);
      }
    }
  });

  // Handle late-joining students requesting current broadcast
  socket.on('request-broadcast-status', (data) => {
    const { roomId, studentSocketId } = data;
    console.log(`Student ${studentSocketId} requesting broadcast status for room: ${roomId}`);
    
    // Check if there's an active broadcast for this room
    const activeBroadcast = activeBroadcasts.get(roomId);
    if (activeBroadcast && activeBroadcast.isActive && activeBroadcast.tutorSocketId !== socket.id) {
      console.log(`Active broadcast found, connecting student ${studentSocketId}`);
      
      // Tell the tutor to create a connection for this student
      const tutorSocket = io.sockets.sockets.get(activeBroadcast.tutorSocketId);
      if (tutorSocket) {
        tutorSocket.emit('student-join-broadcast', {
          roomId,
          studentSocketId
        });
      }
    } else {
      console.log(`No active broadcast found for room: ${roomId}`);
    }
  });

  // Handle voice answer from students to tutor
  socket.on('voice-answer', (data) => {
    const { roomId, answer, socketId } = data;
    console.log(`Voice answer from student ${socketId} in room: ${roomId}`);
    
    // Find the tutor in the room and send the answer
    const activeBroadcast = activeBroadcasts.get(roomId);
    if (activeBroadcast) {
      const tutorSocket = io.sockets.sockets.get(activeBroadcast.tutorSocketId);
      if (tutorSocket) {
        tutorSocket.emit('voice-answer', {
          roomId,
          answer,
          studentSocketId: socketId
        });
        console.log(`Forwarded answer from student ${socketId} to tutor`);
      } else {
        console.error(`Tutor socket not found: ${activeBroadcast.tutorSocketId}`);
      }
    } else {
      console.error(`No active broadcast found for room: ${roomId}`);
    }
  });

  // Handle ICE candidates exchange
  socket.on('voice-ice-candidate', (data) => {
    const { roomId, candidate } = data;
    
    // Broadcast ICE candidate to all other users in the room
    socket.to(roomId).emit('voice-ice-candidate', {
      roomId,
      candidate,
      fromSocketId: socket.id
    });
  });

  // Handle voice broadcast ended by tutor
  socket.on('voice-broadcast-ended', (data) => {
    const { roomId } = data;
    console.log(`Voice broadcast ended in room: ${roomId}`);
    
    // Mark broadcast as inactive and clean up
    const activeBroadcast = activeBroadcasts.get(roomId);
    if (activeBroadcast) {
      activeBroadcast.isActive = false;
      // Keep the entry for a short time in case of reconnects
      setTimeout(() => {
        activeBroadcasts.delete(roomId);
      }, 5000);
    }
    
    // Notify all students in the room that broadcast has ended
    socket.to(roomId).emit('voice-broadcast-ended', {
      roomId
    });
  });

  // Handle tutor disconnection - automatically end voice broadcast
  socket.on('disconnect', () => {
    console.log(`Socket ${socket.id} disconnected`);
    
    // Find any broadcasts this tutor was hosting and end them
    activeBroadcasts.forEach((broadcast, roomId) => {
      if (broadcast.tutorSocketId === socket.id && broadcast.isActive) {
        broadcast.isActive = false;
        // Notify students that broadcast ended due to disconnection
        io.to(roomId).emit('voice-broadcast-ended', {
          roomId,
          reason: 'tutor_disconnected'
        });
        console.log(`Ended broadcast in room ${roomId} due to tutor disconnection`);
        
        // Clean up after a delay
        setTimeout(() => {
          activeBroadcasts.delete(roomId);
        }, 5000);
      }
    });
  });

  // Optional: Handle voice quality/connection issues
  socket.on('voice-connection-quality', (data) => {
    const { roomId, quality, socketId } = data;
    console.log(`Voice quality report from ${socketId} in room ${roomId}:`, quality);
    
    // Forward to tutor for monitoring
    socket.to(roomId).emit('voice-quality-update', {
      roomId,
      quality,
      fromSocketId: socketId
    });
  });
}