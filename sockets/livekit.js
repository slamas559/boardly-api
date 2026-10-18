// sockets/livekit.js
// Voice for the room runs through LiveKit, a media server (SFU): every speaker sends one audio stream to the
// server and the server fans it out to every listener. That is what lets a large room have many people
// speaking at once, which direct peer-to-peer connections cannot do.
//
// Needs these environment variables (a LiveKit Cloud project, or your own LiveKit server):
//   LIVEKIT_URL         e.g. wss://your-project.livekit.cloud
//   LIVEKIT_API_KEY
//   LIVEKIT_API_SECRET
import { AccessToken, RoomServiceClient, TrackSource } from "livekit-server-sdk";

const BATCH = 20;

export const voiceConfigured = () => Boolean(
  process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET
);

export const livekitRoomName = (roomId) => `boardly-${roomId}`;
export const livekitUrl = () => process.env.LIVEKIT_URL;

let service = null;
function roomService() {
  if (!service) {
    const httpUrl = process.env.LIVEKIT_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
    service = new RoomServiceClient(httpUrl, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
  }
  return service;
}

const permission = (canPublish) => ({
  canSubscribe: true,
  canPublish,
  canPublishData: false,
  canPublishSources: [TrackSource.MICROPHONE],
});

/** A short-lived pass to join the room's voice session. Only people allowed to speak may publish audio. */
export async function createVoiceToken({ roomId, identity, name, key, host, canSpeak }) {
  const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity,
    name,
    metadata: JSON.stringify({ key, host: Boolean(host) }),
    ttl: "2h",
  });
  token.addGrant({ roomJoin: true, room: livekitRoomName(roomId), ...permission(Boolean(canSpeak)) });
  return token.toJwt();
}

/**
 * Re-check who may speak after the host changes the permissions. `mayPublish(participantKey)` decides; the
 * server changes each person's permission in place, so nobody has to reconnect, and a person who loses
 * permission is cut off straight away.
 */
export async function syncSpeakers(roomId, mayPublish) {
  if (!voiceConfigured()) return;
  const name = livekitRoomName(roomId);
  let participants;
  try {
    participants = await roomService().listParticipants(name);
  } catch {
    return; // no voice session is running
  }
  const changes = [];
  for (const p of participants) {
    let meta = {};
    try { meta = JSON.parse(p.metadata || "{}"); } catch { /* ignore */ }
    const want = meta.host === true || mayPublish(meta.key);
    if (Boolean(p.permission?.canPublish) !== want) changes.push([p.identity, want]);
  }
  for (let i = 0; i < changes.length; i += BATCH) {
    await Promise.all(changes.slice(i, i + BATCH).map(([identity, want]) =>
      roomService().updateParticipant(name, identity, undefined, permission(want)).catch(() => {})));
  }
}

/** End the voice session for the room and disconnect everyone from it. */
export async function closeVoiceRoom(roomId) {
  if (!voiceConfigured()) return;
  try {
    await roomService().deleteRoom(livekitRoomName(roomId));
  } catch { /* nothing was running */ }
}
