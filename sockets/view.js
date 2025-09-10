// sockets/view.js
export default function viewEvents(socket, io) {
  socket.on("change-view", ({ roomId, view }) => {
      console.log(`📄 View changed to "${view}" in room ${roomId}`);
      // Broadcast new view to everyone in the room
      socket.to(roomId).emit("change-view", view);
    });
}
