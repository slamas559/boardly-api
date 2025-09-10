export default function qaEvents(socket, io) {
    // Handle Q&A status changes
    socket.on('qa-status-change', ({ roomId, enabled }) => {
        socket.to(roomId).emit('qa-status-changed', { enabled });
    });

    // Handle new questions
    socket.on('new-question', ({ roomId, question }) => {
        socket.to(roomId).emit('new-question', question);
    });

    // Handle question answered
    socket.on('question-answered', ({ roomId, questionId }) => {
        socket.to(roomId).emit('question-answered', { questionId });
    });
}