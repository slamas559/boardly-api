// sockets/chat.js
export default function chatEvents(socket, io) {
  socket.on("new-message", ({ room, message }) => {
    io.to(room).emit("new-message", message);
  });
}
