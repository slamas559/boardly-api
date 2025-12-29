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
  
  // Handle PDF annotations - with proper removal support
  socket.on("pdf-annotation", ({ roomId, annotation }) => {
    console.log("📝 PDF annotation event:", {
      roomId,
      annotationId: annotation.id,
      removed: annotation.removed,
      type: annotation.type
    });
    
    // Broadcast to all other users in the room
    socket.to(roomId).emit("pdf-annotation", { annotation });
  });
  
  // Optional: Separate event for removing annotations
  socket.on("pdf-annotation-remove", ({ roomId, annotationId }) => {
    console.log("🗑️ PDF annotation remove:", { roomId, annotationId });
    
    socket.to(roomId).emit("pdf-annotation-removed", { 
      annotation: { id: annotationId, removed: true }
    });
  });
}