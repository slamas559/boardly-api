// sockets/audio.js
export default function audioEvents(socket, io) {
  socket.on("start-audio-stream", ({ room }) => {
    socket.to(room).emit("audio-started");
  });

  socket.on("signal", ({ room, signalData }) => {
    socket.to(room).emit("signal", signalData);
  });
}
