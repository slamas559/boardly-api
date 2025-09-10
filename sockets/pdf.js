// sockets/pdf.js
export default function pdfEvents(socket, io) {
  socket.on("pdf-page-change", ({ room, page }) => {
    socket.broadcast.to(room).emit("pdf-page-change", { page });
  });
  socket.on("pdf-updated", ({ url, room }) => {
    socket.broadcast.to(room).emit("pdf-updated", { url });
  });
  socket.on("pdf-scroll", ({ roomId, scrollTop }) => {
    socket.broadcast.to(roomId).emit("pdf-scroll", { scrollTop });
    console.log(`PDF scroll in room ${roomId}: ${scrollTop}`);
  });
  // when receiving an annotation
  socket.on("pdf-annotation", ({ roomId, annotation }) => {
    // if annotation.removed, you might re-emit to special event; here we broadcast actual annotation object
    socket.to(roomId).emit("pdf-annotation", { annotation });
  });
  // optional: handle removing via separate event
  socket.on("pdf-annotation-remove", ({ roomId, annotationId }) => {
    socket.to(roomId).emit("pdf-annotation-removed", { annotation: { id: annotationId, removed: true }});
  });
}
