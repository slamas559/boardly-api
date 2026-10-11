// sockets/view.js
import { getRoomState, markDirty } from "./roomState.js";
import { requireHost } from "./permissions.js";

const VIEWS = new Set(["whiteboard", "pdf"]);

export default function viewEvents(socket, io) {
  socket.on("change-view", async ({ roomId, view } = {}) => {
    if (!requireHost(socket, roomId) || !VIEWS.has(view)) return;
    const state = await getRoomState(roomId);
    if (state) {
      state.view = view;
      markDirty(state);
    }
    socket.to(roomId).emit("change-view", view);
  });
}
