// sockets/whiteboard.js
// Realtime whiteboard events. The verified host (room creator) controls the board; a listener the host has
// let draw can add to it and change only their own objects. Page, view and pointer control stay with the host.
import { applyOps, applyStrokeChunk, BOARD_OBJECT_TYPES, limitGuestOps, validateObject } from "./boardOps.js";
import { getRoomState, markDirty } from "./roomState.js";
import { canDraw, isHost, participantKey, requireHost } from "./permissions.js";

export default function whiteboardEvents(socket, io) {
  // Batched object operations: add / update / remove / clear
  socket.on("board-op", async ({ room, ops } = {}) => {
    if (!canDraw(socket, room)) return;
    const state = await getRoomState(room);
    if (!state) return;

    const allowed = isHost(socket, room) ? ops : limitGuestOps(state.board.objects, ops, participantKey(socket));
    const applied = applyOps(state.board.objects, allowed, { allowedTypes: BOARD_OBJECT_TYPES });
    if (applied.length === 0) return;

    // Keep the page counter honest if objects reference pages beyond it
    for (const op of applied) {
      const page = op.op === "add" ? op.obj.page : undefined;
      if (Number.isInteger(page) && page + 1 > state.board.pageCount) state.board.pageCount = page + 1;
    }

    markDirty(state);
    socket.to(room).emit("board-op", { ops: applied });
  });

  // Live freehand streaming (points arrive in small chunks while the host is still drawing)
  socket.on("board-stroke", async ({ room, id, page, meta, points } = {}) => {
    if (!canDraw(socket, room)) return;
    const state = await getRoomState(room);
    if (!state) return;

    const by = isHost(socket, room) ? undefined : participantKey(socket);
    const stroke = applyStrokeChunk(state.board.objects, { id, page, meta, points }, { by });
    if (!stroke) return;

    markDirty(state);
    socket.to(room).emit("board-stroke", { id, page: stroke.page, meta: meta && by ? { ...meta, by } : meta, points });
  });

  // Transient previews are relayed only; they are never added to room state or persisted.
  socket.on("board-preview", ({ room, id, page, obj, active } = {}) => {
    if (!canDraw(socket, room) || typeof id !== "string" || id.length > 48
      || !Number.isInteger(page) || page < 0 || page > 499) return;
    if (active !== false) {
      if (!obj || obj.id !== id || obj.page !== page || !validateObject(obj, BOARD_OBJECT_TYPES)) return;
      try {
        if (JSON.stringify(obj).length > 64 * 1024) return;
      } catch {
        return;
      }
    }
    socket.to(room).emit("board-preview", { id, page, obj: active === false ? null : obj, active: active !== false });
  });

  socket.on("board-page", async ({ room, page, pageCount } = {}) => {
    if (!requireHost(socket, room)) return;
    if (!Number.isInteger(page) || page < 0 || page > 499) return;
    const state = await getRoomState(room);
    if (!state) return;

    state.board.page = page;
    if (Number.isInteger(pageCount) && pageCount >= 1 && pageCount <= 500) {
      state.board.pageCount = Math.max(pageCount, page + 1);
    }
    markDirty(state);
    socket.to(room).emit("board-page", { page, pageCount: state.board.pageCount });
  });

  // The host's visible region, so followers can mirror it on any screen size
  socket.on("board-view", ({ room, rect, page } = {}) => {
    if (!requireHost(socket, room)) return;
    if (!rect || ![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) return;
    socket.to(room).emit("board-view", { rect, page });
  });

  // Laser pointer for both the board and PDF views (world coordinates)
  socket.on("pointer", ({ room, view, page, x, y, active, tool, angle } = {}) => {
    if (!requireHost(socket, room)) return;
    if (!["board", "pdf"].includes(view) || !Number.isInteger(page) || page < 0 || page > 499) return;
    if (active !== false && (!(Number.isFinite(x) && Number.isFinite(y))
      || Math.abs(x) > 1_000_000 || Math.abs(y) > 1_000_000
      || (tool !== undefined && (typeof tool !== "string" || tool.length > 24))
      || (angle !== undefined && !Number.isFinite(angle)))) return;
    socket.to(room).emit("pointer", { view, page, x, y, active, tool, angle });
  });
}
