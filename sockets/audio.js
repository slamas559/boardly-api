// backend/sockets/voice.js - Fixed Deepgram integration

import { createClient } from '@deepgram/sdk';
import fetch from 'cross-fetch';
import 'dotenv/config';

// Initialize Deepgram client
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const deepgram = createClient(DEEPGRAM_API_KEY);

// Store active transcription connections
const activeTranscriptions = new Map(); // roomId -> { connection, tutorSocketId }

// Store active voice broadcasts by room
const activeBroadcasts = new Map();

export default function voiceEvents(socket, io) {
  
  // Handle voice broadcast started by tutor
  socket.on('voice-broadcast-started', (data) => {
    const { roomId } = data;
    console.log(`Voice broadcast started by tutor in room: ${roomId}`);
    
    activeBroadcasts.set(roomId, {
      tutorSocketId: socket.id,
      isActive: true
    });
    
    socket.to(roomId).emit('voice-broadcast-started', {
      roomId,
      tutorSocketId: socket.id
    });
  });
  
  // Handle transcription start request from tutor
  socket.on('start-transcription', async (data) => {
    const { roomId } = data;
    // console.log(`Starting transcription for room: ${roomId}`);
    
    try {
      // Create Deepgram live transcription connection
      const connection = deepgram.listen.live({
        model: 'nova-3',
        language: 'en-US',
        smart_format: true,
        interim_results: true,
        punctuate: true,
        utterance_end_ms: 1000,
        vad_events: true,
        endpointing: 300,
        encoding: 'linear16',
        sample_rate: 16000,
        channels: 1
      });
      
      // console.log("Deepgram connection created");

      // Set up event listeners BEFORE opening
      connection.on('open', () => {
        console.log(`✓ Deepgram connection opened for room: ${roomId}`);
        socket.emit('transcription-started', { roomId });
      });

      connection.on('close', () => {
        console.log(`Deepgram connection closed for room: ${roomId}`);
        activeTranscriptions.delete(roomId);
      });

      connection.on('error', (error) => {
        console.error(`Deepgram error in room ${roomId}:`, error);
        socket.emit('transcription-error', { 
          roomId, 
          error: error.message 
        });
        activeTranscriptions.delete(roomId);
      });

      connection.on('warning', (warning) => {
        console.warn(`Deepgram warning in room ${roomId}:`, warning);
      });

      connection.on('Results', (data) => {
        // console.log('Received Deepgram transcript event:', JSON.stringify(data, null, 2));
        
        const transcript = data.channel?.alternatives?.[0]?.transcript;
        
        if (transcript && transcript.trim().length > 0) {
          const isFinal = data.is_final;
          const confidence = data.channel?.alternatives?.[0]?.confidence || 0;
          
          // console.log(`Transcription (${isFinal ? 'final' : 'interim'}): ${transcript}`);
          
          // Broadcast to all users in the room
          io.to(roomId).emit('subtitle-received', {
            text: transcript,
            isFinal: isFinal,
            timestamp: Date.now(),
            confidence: confidence
          });
        }
      });

      // connection.on('UtteranceEnd', (data) => {
      //   console.log('Utterance ended:', data);
      // });

      // connection.on('metadata', (metadata) => {
      //   console.log(`Deepgram metadata for room ${roomId}:`, metadata);
      // });

      // Store the connection
      activeTranscriptions.set(roomId, {
        connection,
        tutorSocketId: socket.id
      });

      console.log("Connection stored and ready");
      
    } catch (error) {
      console.error('Failed to start transcription:', error);
      socket.emit('transcription-error', { 
        roomId, 
        error: error.message 
      });
    }
  });


  // Handle audio data from tutor's microphone
  socket.on('audio-data', (data) => {
    const { roomId, audioData } = data;
    
    const transcription = activeTranscriptions.get(roomId);
    
    if (transcription && transcription.connection) {
      try {
        // Check if connection is ready
        const readyState = transcription.connection.getReadyState();
        
        if (readyState === 1) { // OPEN
          // Convert ArrayBuffer to Buffer and send
          const buffer = Buffer.from(audioData);
          transcription.connection.send(buffer);
          // console.log(`Audio sent: ${buffer.length} bytes`);
        } else {
          console.warn(`Connection not ready for room ${roomId}. ReadyState: ${readyState}`);
        }
      } catch (error) {
        console.error(`Error sending audio data for room ${roomId}:`, error);
      }
    } else {
      console.warn(`No active transcription found for room ${roomId}`);
    }
  });

  // Handle transcription stop request
  socket.on('stop-transcription', (data) => {
    const { roomId } = data;
    // console.log(`Stopping transcription for room: ${roomId}`);
    
    const transcription = activeTranscriptions.get(roomId);
    if (transcription && transcription.connection) {
      try {
        transcription.connection.finish();
      } catch (error) {
        console.error(`Error finishing transcription for room ${roomId}:`, error);
      }
      activeTranscriptions.delete(roomId);
      
      // Notify students
      io.to(roomId).emit('transcription-stopped', { roomId });
    }
  });

  // Handle subtitle settings update
  socket.on('subtitle-settings-update', (data) => {
    const { roomId, settings } = data;
    console.log(`Subtitle settings updated in room ${roomId}`);
    
    socket.to(roomId).emit('subtitle-settings-updated', { settings });
  });

  // Clear subtitles for all students
  socket.on('clear-subtitles', (data) => {
    const { roomId } = data;
    console.log(`Clearing subtitles in room ${roomId}`);
    
    socket.to(roomId).emit('subtitles-cleared', { roomId });
  });

  // === EXISTING VOICE BROADCAST CODE ===
  
  socket.on('voice-offer', (data) => {
    const { roomId, offer, targetStudentId } = data;
    console.log(`Voice offer from tutor in room: ${roomId}`, targetStudentId ? `for student: ${targetStudentId}` : 'for all students');
    
    if (targetStudentId) {
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
      socket.to(roomId).emit('voice-offer', {
        roomId,
        offer,
        tutorSocketId: socket.id
      });
    }
  });

  socket.on('student-join-broadcast', (data) => {
    const { roomId, studentSocketId } = data;
    console.log(`Student ${studentSocketId} requesting to join broadcast in room: ${roomId}`);
    
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

  socket.on('request-broadcast-status', (data) => {
    const { roomId, studentSocketId } = data;
    console.log(`Student ${studentSocketId} requesting broadcast status for room: ${roomId}`);
    
    const activeBroadcast = activeBroadcasts.get(roomId);
    if (activeBroadcast && activeBroadcast.isActive && activeBroadcast.tutorSocketId !== socket.id) {
      console.log(`Active broadcast found, connecting student ${studentSocketId}`);
      
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

  socket.on('voice-answer', (data) => {
    const { roomId, answer, socketId } = data;
    console.log(`Voice answer from student ${socketId} in room: ${roomId}`);
    
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

  socket.on('voice-ice-candidate', (data) => {
    const { roomId, candidate } = data;
    
    socket.to(roomId).emit('voice-ice-candidate', {
      roomId,
      candidate,
      fromSocketId: socket.id
    });
  });

  socket.on('voice-broadcast-ended', (data) => {
    const { roomId } = data;
    console.log(`Voice broadcast ended in room: ${roomId}`);
    
    // Stop transcription if active
    const transcription = activeTranscriptions.get(roomId);
    if (transcription && transcription.connection) {
      try {
        transcription.connection.finish();
      } catch (error) {
        console.error(`Error finishing transcription on broadcast end:`, error);
      }
      activeTranscriptions.delete(roomId);
    }
    
    const activeBroadcast = activeBroadcasts.get(roomId);
    if (activeBroadcast) {
      activeBroadcast.isActive = false;
      setTimeout(() => {
        activeBroadcasts.delete(roomId);
      }, 5000);
    }
    
    socket.to(roomId).emit('voice-broadcast-ended', { roomId });
  });

  socket.on('disconnect', () => {
    console.log(`Socket ${socket.id} disconnected`);
    
    // Clean up transcriptions
    activeTranscriptions.forEach((transcription, roomId) => {
      if (transcription.tutorSocketId === socket.id) {
        try {
          transcription.connection.finish();
        } catch (error) {
          console.error(`Error finishing transcription on disconnect:`, error);
        }
        activeTranscriptions.delete(roomId);
        io.to(roomId).emit('transcription-stopped', { roomId });
      }
    });
    
    // Clean up broadcasts
    activeBroadcasts.forEach((broadcast, roomId) => {
      if (broadcast.tutorSocketId === socket.id && broadcast.isActive) {
        broadcast.isActive = false;
        io.to(roomId).emit('voice-broadcast-ended', {
          roomId,
          reason: 'tutor_disconnected'
        });
        console.log(`Ended broadcast in room ${roomId} due to tutor disconnection`);
        
        setTimeout(() => {
          activeBroadcasts.delete(roomId);
        }, 5000);
      }
    });
  });

  socket.on('voice-connection-quality', (data) => {
    const { roomId, quality, socketId } = data;
    console.log(`Voice quality report from ${socketId} in room ${roomId}:`, quality);
    
    socket.to(roomId).emit('voice-quality-update', {
      roomId,
      quality,
      fromSocketId: socketId
    });
  });
}