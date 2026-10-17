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

export const BOARD_OBJECT_TYPES = new Set([...OBJECT_TYPES, "graph", "table", "media", "equation", "paper", "aid", "instrument", "stats", "cover"]);
export const INSTRUMENT_KINDS = { ruler: [160, 1600], protractor: [160, 1200], square45: [120, 1000], square3060: [160, 1200] };
export const PAPER_KINDS = new Set(["dots", "grid", "plane", "isometric", "lined", "blank"]);

export const LIMITS = {
  maxObjects: 20000,
  maxPoints: 20000,
  maxTextLength: 5000,
  maxRects: 400,
  maxPage: 499,
  maxPatchBytes: 200 * 1024,
  maxTableRows: 12,
  maxTableColumns: 12,
  maxEquationLength: 120,
  maxInequalityLength: 967,
  maxGraphParams: 13,
  maxLatexLength: 600,
  maxNumberLineTicks: 200,
  maxNumberLineMarks: 12,
  maxNumberLineJumps: 8,
  maxFractionBars: 4,
  maxFractionParts: 24,
  maxStatsColumns: 4,
  maxStatsRows: 300,
};

const isFiniteNum = (n) => typeof n === "number" && Number.isFinite(n);

export function validateObject(obj, allowedTypes = OBJECT_TYPES) {
  if (!obj || typeof obj !== "object") return false;
  if (typeof obj.id !== "string" || obj.id.length === 0 || obj.id.length > 48) return false;
  if (!allowedTypes.has(obj.type)) return false;
  if (obj.page !== undefined && !(Number.isInteger(obj.page) && obj.page >= 0 && obj.page <= LIMITS.maxPage)) {
    // PDF pages are 1-based, board pages 0-based; both are small non-negative integers
    return false;
  }
  // Objects glued together by the group tool share a groupId (null / absent when not grouped)
  if (obj.groupId !== undefined && obj.groupId !== null
    && (typeof obj.groupId !== "string" || obj.groupId.length === 0 || obj.groupId.length > 48)) return false;
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
  if (obj.type === "graph") {
    if (typeof obj.expression !== "string" || obj.expression.length === 0) return false;
    const mode = obj.mode || "explicit";
    if (!["explicit", "implicit", "inequality", "parametric", "polar", "surface3d", "curve3d", "parametricSurface3d"].includes(mode)) return false;
    const maxExpressionLength = mode === "inequality" ? LIMITS.maxInequalityLength : LIMITS.maxEquationLength;
    if (obj.expression.length > maxExpressionLength) return false;
    if (mode === "implicit" && (obj.expression.match(/=/g) || []).length !== 1) return false;
    if (mode === "inequality") {
      const lines = obj.expression.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (lines.length === 0 || lines.length > 8 || lines.some((line) =>
        line.length > LIMITS.maxEquationLength || (line.match(/<=|>=|<|>/g) || []).length !== 1
      )) return false;
    }
    if (mode === "parametric" && (
      typeof obj.xExpression !== "string" || obj.xExpression.length === 0 || obj.xExpression.length > LIMITS.maxEquationLength
      || typeof obj.yExpression !== "string" || obj.yExpression.length === 0 || obj.yExpression.length > LIMITS.maxEquationLength
    )) return false;
    if (mode === "curve3d" || mode === "parametricSurface3d") {
      if (typeof obj.xExpression !== "string" || obj.xExpression.length === 0 || obj.xExpression.length > LIMITS.maxEquationLength
        || typeof obj.yExpression !== "string" || obj.yExpression.length === 0 || obj.yExpression.length > LIMITS.maxEquationLength
        || typeof obj.zExpression !== "string" || obj.zExpression.length === 0 || obj.zExpression.length > LIMITS.maxEquationLength) return false;
    }
    if (["surface3d", "curve3d", "parametricSurface3d"].includes(mode)) {
      if (!isFiniteNum(obj.zMin) || !isFiniteNum(obj.zMax) || Math.abs(obj.zMin) > 1_000_000
        || Math.abs(obj.zMax) > 1_000_000 || obj.zMin >= obj.zMax
        || !isFiniteNum(obj.azimuth) || Math.abs(obj.azimuth) > 360_000
        || !isFiniteNum(obj.elevation) || obj.elevation < 12 || obj.elevation > 82) return false;
    }
    for (const key of ["x", "y", "w", "h", "xMin", "xMax", "yMin", "yMax"]) {
      if (!isFiniteNum(obj[key])) return false;
    }
    if (obj.w < 80 || obj.h < 80 || obj.w > 100000 || obj.h > 100000) return false;
    if (Math.abs(obj.xMin) > 1_000_000 || Math.abs(obj.xMax) > 1_000_000
      || Math.abs(obj.yMin) > 1_000_000 || Math.abs(obj.yMax) > 1_000_000
      || obj.xMin >= obj.xMax || obj.yMin >= obj.yMax) return false;
    if (mode === "parametric" || mode === "polar") {
      if (!isFiniteNum(obj.tMin) || !isFiniteNum(obj.tMax) || Math.abs(obj.tMin) > 1_000_000
        || Math.abs(obj.tMax) > 1_000_000 || obj.tMin >= obj.tMax) return false;
    }
    if (mode === "curve3d" && (!isFiniteNum(obj.tMin) || !isFiniteNum(obj.tMax)
      || Math.abs(obj.tMin) > 1_000_000 || Math.abs(obj.tMax) > 1_000_000 || obj.tMin >= obj.tMax)) return false;
    if (mode === "parametricSurface3d") {
      if (![obj.uMin, obj.uMax, obj.vMin, obj.vMax].every(isFiniteNum)
        || [obj.uMin, obj.uMax, obj.vMin, obj.vMax].some((value) => Math.abs(value) > 1_000_000)
        || obj.uMin >= obj.uMax || obj.vMin >= obj.vMax) return false;
    }
    // Slider letters: { a: { value, min, max } }
    if (obj.params !== undefined) {
      const entries = obj.params && typeof obj.params === "object" && !Array.isArray(obj.params) ? Object.entries(obj.params) : null;
      if (!entries || entries.length > LIMITS.maxGraphParams || entries.some(([letter, spec]) =>
        !/^[a-z]$/.test(letter) || !spec || typeof spec !== "object"
        || ![spec.value, spec.min, spec.max].every(isFiniteNum)
        || [spec.value, spec.min, spec.max].some((value) => Math.abs(value) > 1_000_000)
        || spec.min >= spec.max)) return false;
    }
    // Trace point on the curve (null switches it off)
    if (obj.trace !== undefined && obj.trace !== null) {
      if (typeof obj.trace !== "object" || Array.isArray(obj.trace) || !isFiniteNum(obj.trace.x) || Math.abs(obj.trace.x) > 1_000_000
        || (obj.trace.tangent !== undefined && typeof obj.trace.tangent !== "boolean")) return false;
    }
    if (obj.keyPoints !== undefined && typeof obj.keyPoints !== "boolean") return false;
    if (obj.geometry !== undefined) {
      const fieldsByKind = {
        point: ["x", "y"],
        vector: ["x", "y", "dx", "dy"],
        segment: ["x1", "y1", "x2", "y2"],
        ray: ["x1", "y1", "x2", "y2"],
        angle: ["ax", "ay", "vx", "vy", "cx", "cy"],
      };
      if (!Array.isArray(obj.geometry) || obj.geometry.length > 24
        || obj.geometry.some((element) => {
          const fields = element && fieldsByKind[element.kind];
          if (element?.kind === "polygon") {
            return typeof element.id !== "string" || element.id.length === 0 || element.id.length > 48
              || typeof element.label !== "string" || element.label.length > 24
              || !Array.isArray(element.vertices) || element.vertices.length < 3 || element.vertices.length > 12
              || element.vertices.some((point) => !Array.isArray(point) || point.length !== 2
                || point.some((value) => !isFiniteNum(value) || Math.abs(value) > 1_000_000))
              || (element.filled !== undefined && typeof element.filled !== "boolean");
          }
          return !fields || typeof element.id !== "string" || element.id.length === 0 || element.id.length > 48
            || (element.label !== undefined && (typeof element.label !== "string" || element.label.length > 24))
            || fields.some((field) => !isFiniteNum(element[field]) || Math.abs(element[field]) > 1_000_000)
            || (element.kind === "angle" && ((element.ax === element.vx && element.ay === element.vy)
              || (element.cx === element.vx && element.cy === element.vy)
              || !["degrees", "radians"].includes(element.angleUnit)))
            || (["segment", "ray"].includes(element.kind) && element.showMeasure !== undefined && typeof element.showMeasure !== "boolean");
        })) return false;
    }
  }
  if (obj.type === "paper") {
    // The pattern behind a page: one per page, with the id "paper-<page>"
    if (!PAPER_KINDS.has(obj.kind) || ![0.5, 1, 2].includes(obj.scale ?? 1)) return false;
    if (!Number.isInteger(obj.page) || obj.page < 0 || obj.id !== `paper-${obj.page}`) return false;
  }
  if (obj.type === "cover") {
    // A panel that hides part of the board from students until the host reveals it
    if (![obj.x, obj.y].every(isFiniteNum) || Math.abs(obj.x) > 10_000_000 || Math.abs(obj.y) > 10_000_000) return false;
    if (!isFiniteNum(obj.w) || obj.w < 40 || obj.w > 20000 || !isFiniteNum(obj.h) || obj.h < 30 || obj.h > 20000) return false;
    if (obj.open !== undefined && typeof obj.open !== "boolean") return false;
    if (obj.label !== undefined && obj.label !== null && (typeof obj.label !== "string" || obj.label.length > 30)) return false;
    if (obj.color !== undefined && (typeof obj.color !== "string" || !/^#[0-9a-fA-F]{3,8}$/.test(obj.color))) return false;
  }
  if (obj.type === "stats") {
    // A data chart: the numbers themselves plus a few display settings
    if (!["histogram", "box", "scatter"].includes(obj.chart)) return false;
    if (![obj.x, obj.y].every(isFiniteNum) || Math.abs(obj.x) > 10_000_000 || Math.abs(obj.y) > 10_000_000) return false;
    if (![obj.w, obj.h].every((n) => isFiniteNum(n) && n >= 200 && n <= 20000)) return false;
    if (obj.color !== undefined && (typeof obj.color !== "string" || !/^#[0-9a-fA-F]{3,8}$/.test(obj.color))) return false;
    if (!Array.isArray(obj.columns) || obj.columns.length < 1 || obj.columns.length > LIMITS.maxStatsColumns) return false;
    const goodColumn = (column) => column && typeof column === "object" && typeof column.name === "string" && column.name.length <= 40
      && Array.isArray(column.values) && column.values.length <= LIMITS.maxStatsRows
      && column.values.every((v) => v === null || (isFiniteNum(v) && Math.abs(v) <= 1_000_000_000));
    if (!obj.columns.every(goodColumn)) return false;
    if (obj.binWidth !== undefined && obj.binWidth !== null && !(isFiniteNum(obj.binWidth) && obj.binWidth > 0 && obj.binWidth <= 1_000_000_000)) return false;
    if (obj.sd !== undefined && !["sample", "population"].includes(obj.sd)) return false;
    if (obj.title !== undefined && obj.title !== null && (typeof obj.title !== "string" || obj.title.length > 80)) return false;
    for (const flag of ["showStats", "showMean", "showMedian", "showCounts", "showValues", "showLine", "showEquation"]) {
      if (obj[flag] !== undefined && typeof obj[flag] !== "boolean") return false;
    }
  }
  if (obj.type === "instrument") {
    // Ruler, protractor or set square: where it sits, how big it is and how far it is turned
    const range = INSTRUMENT_KINDS[obj.kind];
    if (!range) return false;
    if (![obj.x, obj.y].every(isFiniteNum) || Math.abs(obj.x) > 10_000_000 || Math.abs(obj.y) > 10_000_000) return false;
    if (!isFiniteNum(obj.w) || obj.w < range[0] || obj.w > range[1]) return false;
    if (!isFiniteNum(obj.angle) || obj.angle < -720 || obj.angle > 720) return false;
  }
  if (obj.type === "shape" && obj.measure !== undefined && typeof obj.measure !== "boolean") return false;
  if (obj.type === "aid") {
    // Teaching aids: a number line, a unit circle or fraction bars, each with a few bounded settings
    if (![obj.x, obj.y].every(isFiniteNum) || Math.abs(obj.x) > 10_000_000 || Math.abs(obj.y) > 10_000_000) return false;
    if (![obj.w, obj.h].every((n) => isFiniteNum(n) && n >= 20 && n <= 20000)) return false;
    if (obj.color !== undefined && (typeof obj.color !== "string" || !/^#[0-9a-fA-F]{3,8}$/.test(obj.color))) return false;
    const numbers = (list, max) => Array.isArray(list) && list.length <= max && list.every((n) => isFiniteNum(n) && Math.abs(n) <= 1_000_000);
    if (obj.kind === "numberline") {
      if (![obj.min, obj.max, obj.step].every(isFiniteNum) || obj.min >= obj.max || obj.step <= 0 || Math.abs(obj.min) > 1_000_000 || Math.abs(obj.max) > 1_000_000) return false;
      if ((obj.max - obj.min) / obj.step > LIMITS.maxNumberLineTicks) return false;
      if (obj.marks !== undefined && !numbers(obj.marks, LIMITS.maxNumberLineMarks)) return false;
      if (obj.jumps !== undefined && !(Array.isArray(obj.jumps) && obj.jumps.length <= LIMITS.maxNumberLineJumps
        && obj.jumps.every((j) => j && typeof j === "object" && numbers([j.from, j.to], 2)))) return false;
    } else if (obj.kind === "unitcircle") {
      if (!isFiniteNum(obj.angle) || obj.angle < -720 || obj.angle > 720) return false;
      for (const flag of ["snap", "radians", "showTriangle", "showValues"]) {
        if (obj[flag] !== undefined && typeof obj[flag] !== "boolean") return false;
      }
    } else if (obj.kind === "pollbars") {
      // Poll results put on the board: a label and a count for each choice
      if (!Array.isArray(obj.bars) || obj.bars.length < 1 || obj.bars.length > 6) return false;
      if (!obj.bars.every((bar) => bar && typeof bar.label === "string" && bar.label.length <= 80 && Number.isInteger(bar.count) && bar.count >= 0 && bar.count <= 100000)) return false;
      if (obj.correct !== undefined && obj.correct !== null && !(Number.isInteger(obj.correct) && obj.correct >= 0 && obj.correct < obj.bars.length)) return false;
      if (obj.title !== undefined && obj.title !== null && (typeof obj.title !== "string" || obj.title.length > 240)) return false;
    } else if (obj.kind === "fractions") {
      if (obj.shape !== undefined && !["bar", "pie"].includes(obj.shape)) return false;
      if (!Array.isArray(obj.bars) || obj.bars.length < 1 || obj.bars.length > LIMITS.maxFractionBars) return false;
      if (!obj.bars.every((bar) => bar && Number.isInteger(bar.parts) && bar.parts >= 1 && bar.parts <= LIMITS.maxFractionParts
        && Number.isInteger(bar.shaded) && bar.shaded >= 0 && bar.shaded <= bar.parts)) return false;
    } else {
      return false;
    }
  }
  if (obj.type === "equation") {
    // A typeset formula: LaTeX source plus the box it occupies (the clients typeset it themselves)
    if (typeof obj.latex !== "string" || obj.latex.trim().length === 0 || obj.latex.length > LIMITS.maxLatexLength) return false;
    if (![obj.x, obj.y].every(isFiniteNum) || Math.abs(obj.x) > 10_000_000 || Math.abs(obj.y) > 10_000_000) return false;
    if (!isFiniteNum(obj.w) || obj.w <= 0 || obj.w > 100000 || !isFiniteNum(obj.h) || obj.h <= 0 || obj.h > 100000) return false;
    if (!isFiniteNum(obj.fontSize) || obj.fontSize < 4 || obj.fontSize > 1000) return false;
    if (obj.color !== undefined && (typeof obj.color !== "string" || !/^#[0-9a-fA-F]{3,8}$/.test(obj.color))) return false;
  }
  if (obj.type === "table") {
    if (!Number.isInteger(obj.rows) || obj.rows < 1 || obj.rows > LIMITS.maxTableRows
      || !Number.isInteger(obj.cols) || obj.cols < 1 || obj.cols > LIMITS.maxTableColumns
      || !isFiniteNum(obj.x) || !isFiniteNum(obj.y)
      || !isFiniteNum(obj.cellWidth) || obj.cellWidth < 40 || obj.cellWidth > 10000
      || !isFiniteNum(obj.cellHeight) || obj.cellHeight < 24 || obj.cellHeight > 10000
      || !Array.isArray(obj.cells) || obj.cells.length !== obj.rows * obj.cols
      || obj.cells.some((cell) => typeof cell !== "string" || cell.length > 5000)) return false;
  }
  if (obj.type === "media") {
    let mediaUrl;
    try {
      mediaUrl = new URL(obj.src);
    } catch {
      return false;
    }
    const mediaHost = mediaUrl.hostname.toLowerCase();
    const cloudinaryAsset = mediaUrl.protocol === "https:" && !mediaUrl.username && !mediaUrl.password
      && mediaHost === "res.cloudinary.com";
    const directVideo = mediaUrl.protocol === "https:" && !mediaUrl.username && !mediaUrl.password
      && /\.(?:mp4|webm|ogg|mov|m4v)$/i.test(mediaUrl.pathname);
    const safeEmbedUrl = mediaUrl.protocol === "https:" && !mediaUrl.username && !mediaUrl.password && !mediaUrl.port;
    const youtubeEmbed = safeEmbedUrl && mediaHost === "www.youtube-nocookie.com"
      && /^\/embed\/[A-Za-z0-9_-]{11}$/.test(mediaUrl.pathname);
    const vimeoEmbed = safeEmbedUrl && mediaHost === "player.vimeo.com"
      && /^\/video\/\d{6,12}$/.test(mediaUrl.pathname);
    const validMediaUrl = obj.mediaType === "image" ? cloudinaryAsset
      : obj.mediaType === "video" ? (cloudinaryAsset || directVideo)
        : obj.mediaType === "embed" ? ((obj.provider === "youtube" && youtubeEmbed)
          || (obj.provider === "vimeo" && vimeoEmbed)
          || (obj.provider === "direct" && directVideo))
          : false;
    if (!validMediaUrl
      || typeof obj.src !== "string" || obj.src.length > 2048
      || !isFiniteNum(obj.x) || !isFiniteNum(obj.y)
      || !isFiniteNum(obj.w) || obj.w < 40 || obj.w > 100000
      || !isFiniteNum(obj.h) || obj.h < 40 || obj.h > 100000
      || (obj.playing !== undefined && typeof obj.playing !== "boolean")
      || (obj.currentTime !== undefined && (!isFiniteNum(obj.currentTime) || obj.currentTime < 0 || obj.currentTime > 1_000_000))) return false;
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
export function applyOps(objects, ops, { allowedTypes = OBJECT_TYPES } = {}) {
  const applied = [];
  if (!Array.isArray(ops)) return applied;

  for (const op of ops.slice(0, 500)) {
    if (!op || typeof op !== "object") continue;

    switch (op.op) {
      case "add": {
        if (!validateObject(op.obj, allowedTypes)) break;
        if (!objects.has(op.obj.id) && objects.size >= LIMITS.maxObjects) break;
        objects.set(op.obj.id, op.obj);
        applied.push(op);
        break;
      }
      case "update": {
        const existing = objects.get(op.id);
        if (!existing || !patchIsSafe(op.patch)) break;
        const next = { ...existing, ...op.patch };
        if (!validateObject(next, allowedTypes)) break;
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
          // A page's paper stays when its contents are cleared
          if (o.type !== "paper" && (page === undefined || o.page === page)) objects.delete(id);
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
