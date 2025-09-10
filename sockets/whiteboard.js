// sockets/whiteboard.js
export default function whiteboardEvents(socket, io) {
  socket.on("whiteboard-draw", (data) => {
    socket.broadcast.to(data.room).emit("whiteboard-draw", data);
  });

  socket.on("whiteboard-clear", (roomId) => {
    socket.broadcast.to(roomId).emit("whiteboard-clear");
  });

  socket.on("whiteboard-text", (data) => {
    socket.broadcast.to(data.room).emit("whiteboard-text", data);
  });
}