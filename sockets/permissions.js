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
