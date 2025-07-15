// sockets/whiteboard.js
export default function whiteboardEvents(socket, io) {
  socket.on("draw", (data) => {
    socket.broadcast.to(data.room).emit("draw", data);
  });

  socket.on("clear-board", (roomId) => {
    socket.broadcast.to(roomId).emit("clear-board");
  });
}
