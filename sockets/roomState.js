// sockets/roomState.js
// Authoritative live state for a room: board objects + PDF annotations.
// Loaded lazily from MongoDB, mutated in memory by socket events, flushed back on a debounce.
import Room from "../models/Room.js";

const FLUSH_DELAY_MS = 2000;
const states = new Map(); // roomId -> state
const loading = new Map(); // roomId -> Promise<state>

function toMap(list) {
  const map = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    if (item && typeof item.id === "string" && !item.removed) map.set(item.id, item);
  }
  return map;
}

async function loadState(roomId) {
  const room = await Room.findById(roomId).lean();
  if (!room) return null;
  return {
    roomId,
    creatorId: room.creator?.toString(),
    view: room.currentView || "whiteboard",
    board: {
      objects: toMap(room.board?.objects),
      pageCount: Math.max(1, room.board?.pageCount || 1),
      page: 0,
      legacyImage: room.whiteboardImage || null,
    },
    pdf: {
      url: room.pdf?.url || null,
      currentPage: room.pdf?.currentPage || 1,
      annotations: toMap(room.pdf?.annotations),
    },
    dirty: false,
    timer: null,
  };
}

export async function getRoomState(roomId) {
  const cached = states.get(roomId);
  if (cached) return cached;
  if (loading.has(roomId)) return loading.get(roomId);

  const promise = loadState(roomId)
    .then((state) => {
      if (state) states.set(roomId, state);
      return state;
    })
    .finally(() => loading.delete(roomId));
  loading.set(roomId, promise);
  return promise;
}

export function serializeState(state) {
  return {
    view: state.view,
    board: {
      objects: [...state.board.objects.values()],
      pageCount: state.board.pageCount,
      page: state.board.page,
      legacyImage: state.board.legacyImage,
    },
    pdf: {
      url: state.pdf.url,
      currentPage: state.pdf.currentPage,
      annotations: [...state.pdf.annotations.values()],
    },
  };
}

export function markDirty(state) {
  state.dirty = true;
  if (state.timer) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    flushState(state).catch((err) => console.error("Room state flush failed:", err.message));
  }, FLUSH_DELAY_MS);
}

export async function flushState(state) {
  if (!state.dirty) return;
  state.dirty = false;
  await Room.updateOne(
    { _id: state.roomId },
    {
      $set: {
        "board.objects": [...state.board.objects.values()],
        "board.pageCount": state.board.pageCount,
        "pdf.annotations": [...state.pdf.annotations.values()],
        "pdf.currentPage": state.pdf.currentPage,
        currentView: state.view,
        lastActivity: new Date(),
      },
    }
  );
}

/** Flush and drop the in-memory copy once nobody is in the room any more. */
export async function releaseRoomState(roomId) {
  const state = states.get(roomId);
  if (!state) return;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  try {
    await flushState(state);
  } finally {
    states.delete(roomId);
  }
}

/** Test helper */
export function _resetRoomStates() {
  for (const s of states.values()) if (s.timer) clearTimeout(s.timer);
  states.clear();
  loading.clear();
}

/** Called by the PDF upload route so a stale in-memory copy can't overwrite the new document. */
export function resetPdfState(roomId, url) {
  const state = states.get(String(roomId));
  if (!state) return;
  state.pdf.url = url;
  state.pdf.currentPage = 1;
  state.pdf.annotations = new Map();
  markDirty(state);
}
