// sockets/boardOps.js
// Pure helpers for validating and applying whiteboard / PDF-annotation operations.
// Objects live in a Map keyed by id so add/update/remove are O(1).

export const OBJECT_TYPES = new Set([
  "stroke",     // freehand pen / highlighter
  "shape",      // rect, ellipse, diamond, line, arrow
  "text",       // text box
  "markup",     // PDF text markup (highlight / underline / strikethrough)
  "highlight",  // legacy PDF highlight (percent rects) - kept so old data still loads
]);

export const LIMITS = {
  maxObjects: 20000,
  maxPoints: 20000,
  maxTextLength: 5000,
  maxRects: 400,
  maxPage: 499,
  maxPatchBytes: 200 * 1024,
};

const isFiniteNum = (n) => typeof n === "number" && Number.isFinite(n);

export function validateObject(obj) {
  if (!obj || typeof obj !== "object") return false;
  if (typeof obj.id !== "string" || obj.id.length === 0 || obj.id.length > 48) return false;
  if (!OBJECT_TYPES.has(obj.type)) return false;
  if (obj.page !== undefined && !(Number.isInteger(obj.page) && obj.page >= 0 && obj.page <= LIMITS.maxPage)) {
    // PDF pages are 1-based, board pages 0-based; both are small non-negative integers
    return false;
  }
  if (obj.type === "stroke") {
    if (!Array.isArray(obj.points) || obj.points.length > LIMITS.maxPoints) return false;
  }
  if (obj.type === "text" && typeof obj.text === "string" && obj.text.length > LIMITS.maxTextLength) return false;
  if (obj.type === "markup" && (!Array.isArray(obj.rects) || obj.rects.length > LIMITS.maxRects)) return false;
  if (obj.type === "shape") {
    for (const k of ["x", "y", "w", "h", "x1", "y1", "x2", "y2"]) {
      if (obj[k] !== undefined && !isFiniteNum(obj[k])) return false;
    }
  }
  return true;
}

function patchIsSafe(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return false;
  if ("id" in patch || "type" in patch) return false;
  try {
    return JSON.stringify(patch).length <= LIMITS.maxPatchBytes;
  } catch {
    return false;
  }
}

/**
 * Apply a list of ops to `objects` (Map<string, object>) in place.
 * Returns only the ops that were valid and applied, so they can be safely relayed.
 */
export function applyOps(objects, ops) {
  const applied = [];
  if (!Array.isArray(ops)) return applied;

  for (const op of ops.slice(0, 500)) {
    if (!op || typeof op !== "object") continue;

    switch (op.op) {
      case "add": {
        if (!validateObject(op.obj)) break;
        if (!objects.has(op.obj.id) && objects.size >= LIMITS.maxObjects) break;
        objects.set(op.obj.id, op.obj);
        applied.push(op);
        break;
      }
      case "update": {
        const existing = objects.get(op.id);
        if (!existing || !patchIsSafe(op.patch)) break;
        const next = { ...existing, ...op.patch };
        if (!validateObject(next)) break;
        objects.set(op.id, next);
        applied.push({ op: "update", id: op.id, patch: op.patch });
        break;
      }
      case "remove": {
        if (typeof op.id === "string" && objects.delete(op.id)) {
          applied.push({ op: "remove", id: op.id });
        }
        break;
      }
      case "clear": {
        // Remove every object on a page (or everything when page is omitted)
        const page = op.page;
        for (const [id, o] of objects) {
          if (page === undefined || o.page === page) objects.delete(id);
        }
        applied.push({ op: "clear", page });
        break;
      }
      default:
        break;
    }
  }
  return applied;
}

/**
 * Streaming freehand strokes: the first message carries `meta` (style), later ones only points.
 * The stroke is created/extended immediately so the stored state is always consistent.
 * Returns the stroke object, or null when the message is rejected.
 */
export function applyStrokeChunk(objects, { id, page, meta, points }) {
  if (typeof id !== "string" || id.length === 0 || id.length > 48) return null;
  if (!Array.isArray(points) || points.length > 500) return null;

  let stroke = objects.get(id);
  if (!stroke) {
    if (!meta || typeof meta !== "object") return null;
    if (objects.size >= LIMITS.maxObjects) return null;
    stroke = {
      id,
      type: "stroke",
      page: Number.isInteger(page) ? page : 0,
      tool: meta.tool === "highlighter" ? "highlighter" : "pen",
      color: typeof meta.color === "string" ? meta.color.slice(0, 40) : "#000000",
      width: isFiniteNum(meta.width) ? meta.width : 3,
      opacity: isFiniteNum(meta.opacity) ? meta.opacity : 1,
      points: [],
    };
  }
  if (stroke.type !== "stroke") return null;
  if (stroke.points.length + points.length > LIMITS.maxPoints) return null;

  const clean = points.filter(
    (p) => Array.isArray(p) && isFiniteNum(p[0]) && isFiniteNum(p[1])
  );
  stroke = { ...stroke, points: stroke.points.concat(clean) };
  objects.set(id, stroke);
  return stroke;
}
