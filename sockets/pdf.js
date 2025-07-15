// sockets/pdf.js
export default function pdfEvents(socket, io) {
  socket.on("pdf-page-change", ({ room, page }) => {
    socket.broadcast.to(room).emit("pdf-page-change", { page });
  });
}
