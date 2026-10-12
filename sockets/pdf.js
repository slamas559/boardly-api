// sockets/pdf.js
// Realtime PDF events. Host-only for everything that changes what listeners see.
import { applyOps, validateObject } from "./boardOps.js";
import { getRoomState, markDirty } from "./roomState.js";
import { requireHost } from "./permissions.js";

export default function pdfEvents(socket, io) {
  socket.on("pdf-page-change", async ({ room, page } = {}) => {
    if (!requireHost(socket, room)) return;
    if (!Number.isInteger(page) || page < 1 || page > 10000) return;
    const state = await getRoomState(room);
    if (state) {
      state.pdf.currentPage = page;
      markDirty(state);
    }
    socket.to(room).emit("pdf-page-change", { page });
  });

  socket.on("pdf-updated", async ({ url, room } = {}) => {
    if (!requireHost(socket, room)) return;
    if (typeof url !== "string" || url.length > 2048) return;
    const state = await getRoomState(room);
    if (state) {
      state.pdf.url = url;
      state.pdf.currentPage = 1;
      state.pdf.annotations = new Map();
      markDirty(state);
    }
    socket.to(room).emit("pdf-updated", { url });
  });

  // Transient text previews are relayed only; they are never persisted as annotations.
  socket.on("pdf-preview", ({ room, id, page, obj, active } = {}) => {
    if (!requireHost(socket, room) || typeof id !== "string" || id.length === 0 || id.length > 48
      || !Number.isInteger(page) || page < 1 || page > 10000) return;
    if (active !== false) {
      if (!obj || obj.id !== id || obj.page !== page || obj.type !== "text" || !validateObject(obj)) return;
      try {
        if (JSON.stringify(obj).length > 64 * 1024) return;
      } catch {
        return;
      }
    }
    socket.to(room).emit("pdf-preview", { id, page, obj: active === false ? null : obj, active: active !== false });
  });

  // Annotation operations: add / update / remove / clear (same op format as the board)
  socket.on("pdf-op", async ({ room, ops } = {}) => {
    if (!requireHost(socket, room)) return;
    const state = await getRoomState(room);
    if (!state) return;

    const applied = applyOps(state.pdf.annotations, ops);
    if (applied.length === 0) return;

    markDirty(state);
    socket.to(room).emit("pdf-op", { ops: applied });
  });
}
