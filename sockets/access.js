// sockets/access.js
// The host decides what listeners may do: draw on the board and document, and speak. Everyone gets the two
// room-wide switches; each person is told only about their own permission, and only the host receives the
// full list, so a big room does not broadcast a long list to everybody.
import { accessSnapshot, isHost, isValidKey, participantKey, requireHost, setAccess } from "./permissions.js";
import { syncSpeakers } from "./livekit.js";

const flagsOf = (snapshot) => ({ drawAll: snapshot.drawAll, speakAll: snapshot.speakAll });
const meOf = (socket, snapshot) => {
  const key = participantKey(socket);
  return { draw: snapshot.draw.includes(key), speak: snapshot.speak.includes(key) };
};

/** Tell one socket what it needs to know (called when someone joins a room). */
export function sendAccess(socket, roomId) {
  const snapshot = accessSnapshot(roomId);
  socket.emit("access-flags", flagsOf(snapshot));
  socket.emit("access-me", meOf(socket, snapshot));
  if (isHost(socket, roomId)) socket.emit("access-state", snapshot);
}

export default function accessEvents(socket, io) {
  // key omitted = everyone in the room; kind is "draw" or "speak"
  socket.on("access-set", async ({ room, kind, key, allowed } = {}) => {
    if (!requireHost(socket, room)) return;
    if (!["draw", "speak"].includes(kind) || typeof allowed !== "boolean") return;
    if (key !== undefined && !isValidKey(key)) return;

    const snapshot = setAccess(room, { kind, key, allowed });
    io.to(room).emit("access-flags", flagsOf(snapshot));
    try {
      for (const peer of await io.in(room).fetchSockets()) {
        if (isHost(peer, room)) peer.emit("access-state", snapshot);
        else if (key !== undefined && participantKey(peer) === key) peer.emit("access-me", meOf(peer, snapshot));
      }
    } catch (error) {
      console.error("access-set error:", error.message);
    }

    if (kind === "speak") {
      const speakers = new Set(snapshot.speak);
      syncSpeakers(room, (participant) => snapshot.speakAll || speakers.has(participant)).catch((error) => {
        console.error("Could not update who can speak:", error.message);
      });
    }
  });
}
