import { requireHost } from "./permissions.js";

const activeRecordings = new Map();

export function isRoomRecording(roomId) {
  return activeRecordings.has(String(roomId));
}

export default function recordingEvents(socket, io) {
  socket.on("recording-state", ({ room, active } = {}) => {
    if (!requireHost(socket, room) || typeof active !== "boolean") return;
    if (active) activeRecordings.set(room, socket.id);
    else if (activeRecordings.get(room) === socket.id) activeRecordings.delete(room);
    else return;
    io.to(room).emit("recording-state", { active });
  });

  socket.on("disconnect", () => {
    for (const [room, hostSocketId] of activeRecordings) {
      if (hostSocketId !== socket.id) continue;
      activeRecordings.delete(room);
      socket.to(room).emit("recording-state", { active: false });
    }
  });
}
