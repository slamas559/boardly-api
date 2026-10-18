// backend/sockets/voice.js - Fixed Deepgram integration

import { createClient } from '@deepgram/sdk';
import fetch from 'cross-fetch';
import 'dotenv/config';
import { requireHost, isHost, canSpeak, participantKey } from './permissions.js';
import { closeVoiceRoom, createVoiceToken, livekitUrl, voiceConfigured } from './livekit.js';

// Initialize Deepgram client
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const deepgram = createClient(DEEPGRAM_API_KEY);

// Store active transcription connections
const activeTranscriptions = new Map(); // roomId -> { connection, tutorSocketId }

// Active voice broadcasts: roomId -> socket id of the host who started it
const activeBroadcasts = new Map();

export const isBroadcasting = (roomId) => activeBroadcasts.has(String(roomId));

function endBroadcast(io, roomId, reason) {
  activeBroadcasts.delete(roomId);
  const transcription = activeTranscriptions.get(roomId);
  if (transcription?.connection) {
    try { transcription.connection.finish(); } catch (error) { console.error("Error finishing transcription:", error); }
    activeTranscriptions.delete(roomId);
    io.to(roomId).emit('transcription-stopped', { roomId });
  }
  io.to(roomId).emit('voice-broadcast-ended', reason ? { roomId, reason } : { roomId });
  closeVoiceRoom(roomId).catch(() => {});
}

export default function voiceEvents(socket, io) {

  // The host starts the room's voice session; listeners are told so they can join it
  socket.on('voice-broadcast-started', ({ roomId } = {}) => {
    if (!requireHost(socket, roomId)) return;
    activeBroadcasts.set(roomId, socket.id);
    socket.to(roomId).emit('voice-broadcast-started', { roomId });
  });

  // A listener who joins late (or reconnects) asks whether a session is already running
  socket.on('request-broadcast-status', ({ roomId } = {}) => {
    if (typeof roomId !== 'string' || !socket.rooms.has(roomId)) return;
    if (activeBroadcasts.has(roomId) && activeBroadcasts.get(roomId) !== socket.id) {
      socket.emit('voice-broadcast-started', { roomId });
    }
  });

  // A pass for the voice session. Everyone can listen; only the host and listeners allowed to speak can publish.
  socket.on('voice-token', async ({ roomId } = {}, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      if (typeof roomId !== 'string' || !socket.rooms.has(roomId)) return reply({ ok: false, error: 'Join the room first.' });
      if (!voiceConfigured()) return reply({ ok: false, error: 'Voice is not set up on this server yet.' });
      const host = isHost(socket, roomId);
      if (!host && !activeBroadcasts.has(roomId)) return reply({ ok: false, error: 'No voice session is running.' });
      const speak = canSpeak(socket, roomId);
      const token = await createVoiceToken({
        roomId,
        identity: socket.id,
        name: socket.data.displayName || 'Guest',
        key: participantKey(socket),
        host,
        canSpeak: speak,
      });
      reply({ ok: true, url: livekitUrl(), token, canSpeak: speak });
    } catch (error) {
      console.error('voice-token error:', error.message);
      reply({ ok: false, error: 'Could not start voice.' });
    }
  });

  // Handle transcription start request from tutor
  socket.on('start-transcription', async (data) => {
    const { roomId } = data || {};
    if (!requireHost(socket, roomId)) return;
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
    const { roomId, audioData } = data || {};
    if (!requireHost(socket, roomId)) return;
    
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
    const { roomId } = data || {};
    if (!requireHost(socket, roomId)) return;
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
    const { roomId, settings } = data || {};
    if (!requireHost(socket, roomId)) return;
    console.log(`Subtitle settings updated in room ${roomId}`);
    
    socket.to(roomId).emit('subtitle-settings-updated', { settings });
  });

  // Clear subtitles for all students
  socket.on('clear-subtitles', (data) => {
    const { roomId } = data || {};
    if (!requireHost(socket, roomId)) return;
    console.log(`Clearing subtitles in room ${roomId}`);
    
    socket.to(roomId).emit('subtitles-cleared', { roomId });
  });

  socket.on('voice-broadcast-ended', ({ roomId } = {}) => {
    if (!requireHost(socket, roomId)) return;
    endBroadcast(io, roomId);
  });

  socket.on('disconnect', () => {
    // The host leaving ends transcription and the voice session
    activeTranscriptions.forEach((transcription, roomId) => {
      if (transcription.tutorSocketId === socket.id) {
        try {
          transcription.connection.finish();
        } catch (error) {
          console.error('Error finishing transcription on disconnect:', error);
        }
        activeTranscriptions.delete(roomId);
        io.to(roomId).emit('transcription-stopped', { roomId });
      }
    });
    activeBroadcasts.forEach((hostSocketId, roomId) => {
      if (hostSocketId === socket.id) endBroadcast(io, roomId, 'tutor_disconnected');
    });
  });
}
