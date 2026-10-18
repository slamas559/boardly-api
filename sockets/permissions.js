// sockets/permissions.js
// A socket is the host of a room only if the JWT cookie sent with the handshake belongs to the
// room's creator. This is decided on the server at join-room; clients cannot claim it.

export function markHost(socket, roomId) {
  if (!socket.data.hostRooms) socket.data.hostRooms = new Set();
  socket.data.hostRooms.add(String(roomId));
}

export function isHost(socket, roomId) {
  return Boolean(roomId) && socket.data.hostRooms?.has(String(roomId)) === true;
}

/** True when the socket has joined the room and is its verified host. */
export function requireHost(socket, roomId) {
  if (!roomId || typeof roomId !== "string") return false;
  if (!socket.rooms.has(roomId)) return false;
  return isHost(socket, roomId);
}

/* ------------------------------------------------------------------ */
/* What the host has opened up to listeners: drawing on the board / document, and speaking.
   Kept in memory per room; the verified host always has both. */

const access = new Map(); // roomId -> { drawAll, speakAll, draw: Set<key>, speak: Set<key> }
const MAX_GRANTS = 5000;
const KEY_PATTERN = /^[A-Za-z0-9_.:@-]{1,80}$/;

/** A stable id for a participant: their account, else the browser's own id, else this connection. */
export function participantKey(socket) {
  return socket.data.userId || socket.data.clientId || socket.id;
}

export const isValidKey = (key) => typeof key === "string" && KEY_PATTERN.test(key);

function entry(roomId) {
  const id = String(roomId);
  if (!access.has(id)) access.set(id, { drawAll: false, speakAll: false, draw: new Set(), speak: new Set() });
  return access.get(id);
}

export function accessSnapshot(roomId) {
  const a = access.get(String(roomId));
  return {
    drawAll: Boolean(a?.drawAll),
    speakAll: Boolean(a?.speakAll),
    draw: a ? [...a.draw] : [],
    speak: a ? [...a.speak] : [],
  };
}

/** Turn drawing or speaking on or off for everyone (`key` omitted) or for one participant. */
export function setAccess(roomId, { kind, key, allowed }) {
  const a = entry(roomId);
  const all = kind === "draw" ? "drawAll" : "speakAll";
  const set = kind === "draw" ? a.draw : a.speak;
  if (key === undefined) {
    a[all] = allowed;
  } else if (allowed) {
    if (set.size < MAX_GRANTS) set.add(key);
  } else {
    set.delete(key);
  }
  return accessSnapshot(roomId);
}

export function releaseAccess(roomId) {
  access.delete(String(roomId));
}

function allowedFor(socket, roomId, kind) {
  if (!roomId || typeof roomId !== "string" || !socket.rooms.has(roomId)) return false;
  if (isHost(socket, roomId)) return true;
  const a = access.get(roomId);
  if (!a) return false;
  return kind === "draw"
    ? a.drawAll || a.draw.has(participantKey(socket))
    : a.speakAll || a.speak.has(participantKey(socket));
}

/** The host, or a listener the host has let draw. */
export const canDraw = (socket, roomId) => allowedFor(socket, roomId, "draw");
/** The host, or a listener the host has let speak. */
export const canSpeak = (socket, roomId) => allowedFor(socket, roomId, "speak");
