// sockets/activity.js
// Live class activities: the host asks a question, students answer from their own device, and the
// server checks the answers. One activity per room at a time, held in memory only (it lasts as long as
// the session). The host is the room's verified creator (see permissions.js); students are everyone else.
//
// What a student may see is decided here, never on the client: the correct answer and the other
// students' answers are only sent after the host chooses to reveal them.
import { isHost, requireHost } from "./permissions.js";

export const ACTIVITY_KINDS = ["choice", "number", "work"];
export const ACTIVITY_LIMITS = {
  prompt: 240,
  option: 80,
  minOptions: 2,
  maxOptions: 6,
  responses: 200,
  image: 300_000, // characters of the data URL (about 220 KB of image)
  name: 40,
  perMinute: 40, // answers one student can send per minute (changing an answer counts)
};

const activities = new Map(); // roomId -> activity

/* ------------------------------ small helpers ------------------------------ */

/** Trim, collapse whitespace and cut to a length. */
export function cleanText(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * A number typed by a student: 12, -3.5, "3,5", "−4", or a fraction such as "3/4". Null when it is not
 * a number (or is absurdly large).
 */
export function parseAnswerNumber(input) {
  if (typeof input === "number") return Number.isFinite(input) && Math.abs(input) <= 1e9 ? input : null;
  if (typeof input !== "string") return null;
  const text = input.trim().replace(/−/g, "-").replace(/\s+/g, "");
  if (!text || text.length > 30) return null;
  const fraction = text.match(/^([-+]?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  let value;
  if (fraction) {
    const bottom = Number(fraction[2]);
    if (bottom === 0) return null;
    value = Number(fraction[1]) / bottom;
  } else if (/^[-+]?\d+,\d+$/.test(text)) {
    value = Number(text.replace(",", ".")); // 3,5 written the way many keyboards do
  } else if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) {
    value = Number(text);
  } else {
    return null;
  }
  return Number.isFinite(value) && Math.abs(value) <= 1e9 ? value : null;
}

const IMAGE_PATTERN = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;

/** A PNG or JPEG data URL of a sensible size whose first bytes really are that kind of image. */
export function validImage(value) {
  if (typeof value !== "string" || value.length > ACTIVITY_LIMITS.image) return false;
  const match = value.match(IMAGE_PATTERN);
  if (!match) return false;
  return match[1] === "png" ? match[2].startsWith("iVBORw0KGgo") : match[2].startsWith("/9j/");
}

/* ------------------------------ the activity itself ------------------------------ */

let counter = 0;

/** Check what the host asked for and build the activity. Returns { ok, activity } or { ok: false, error }. */
export function createActivity(spec, now = Date.now()) {
  if (!spec || typeof spec !== "object") return { ok: false, error: "Missing question." };
  if (!ACTIVITY_KINDS.includes(spec.kind)) return { ok: false, error: "Unknown kind of question." };
  const prompt = cleanText(spec.prompt, ACTIVITY_LIMITS.prompt);
  if (!prompt) return { ok: false, error: "Write the question first." };
  const activity = { id: `act${++counter}-${now.toString(36)}`, kind: spec.kind, prompt, status: "open", startedAt: now, responses: new Map(), spotlight: null };

  if (spec.kind === "choice") {
    const options = (Array.isArray(spec.options) ? spec.options : []).map((option) => cleanText(option, ACTIVITY_LIMITS.option)).filter(Boolean);
    if (options.length < ACTIVITY_LIMITS.minOptions || options.length > ACTIVITY_LIMITS.maxOptions) {
      return { ok: false, error: `Give between ${ACTIVITY_LIMITS.minOptions} and ${ACTIVITY_LIMITS.maxOptions} choices.` };
    }
    activity.options = options;
    if (spec.correct !== undefined && spec.correct !== null) {
      if (!Number.isInteger(spec.correct) || spec.correct < 0 || spec.correct >= options.length) return { ok: false, error: "The correct choice is not one of the choices." };
      activity.correct = spec.correct;
    }
  } else if (spec.kind === "number") {
    if (spec.answer !== undefined && spec.answer !== null) {
      const answer = parseAnswerNumber(spec.answer);
      if (answer === null) return { ok: false, error: "The correct answer is not a number." };
      activity.answer = answer;
      const tolerance = spec.tolerance === undefined || spec.tolerance === null ? 0 : parseAnswerNumber(spec.tolerance);
      if (tolerance === null || tolerance < 0) return { ok: false, error: "The allowed difference must be a number, 0 or more." };
      activity.tolerance = tolerance;
    }
  }
  return { ok: true, activity };
}

/** true / false when the activity has a right answer to check against, otherwise null. */
export function isCorrect(activity, value) {
  if (activity.kind === "choice" && activity.correct !== undefined) return value === activity.correct;
  if (activity.kind === "number" && activity.answer !== undefined) return Math.abs(value - activity.answer) <= (activity.tolerance || 0) + 1e-9;
  return null;
}

/**
 * Record (or replace) one student's answer while the question is open.
 * Returns { ok, response } or { ok: false, error }.
 */
export function submitResponse(activity, key, name, raw, now = Date.now()) {
  if (!activity || activity.status !== "open") return { ok: false, error: "This question is closed." };
  if (!activity.responses.has(key) && activity.responses.size >= ACTIVITY_LIMITS.responses) return { ok: false, error: "This question has all the answers it can take." };
  let value;
  if (activity.kind === "choice") {
    if (!Number.isInteger(raw) || raw < 0 || raw >= activity.options.length) return { ok: false, error: "Pick one of the choices." };
    value = raw;
  } else if (activity.kind === "number") {
    value = parseAnswerNumber(raw);
    if (value === null) return { ok: false, error: "Type a number, like 12, 3.5 or 3/4." };
  } else {
    if (!validImage(raw)) return { ok: false, error: "That drawing could not be sent. Try again." };
    value = raw;
  }
  const response = { key, name: cleanText(name, ACTIVITY_LIMITS.name) || "Student", value, at: now, correct: isCorrect(activity, value) };
  activity.responses.set(key, response);
  return { ok: true, response };
}

export const closeActivity = (activity) => { if (activity.status === "open") activity.status = "closed"; };
export const revealActivity = (activity) => { activity.status = "revealed"; };

/* ------------------------------ what each side may see ------------------------------ */

/** Counts for choices, values for numbers, a total for drawings. Contains no names and no images. */
export function summarize(activity) {
  const answers = [...activity.responses.values()];
  const total = answers.length;
  const correctCount = answers.filter((a) => a.correct === true).length;
  if (activity.kind === "choice") {
    const counts = activity.options.map(() => 0);
    for (const answer of answers) counts[answer.value]++;
    return { total, counts, correctCount };
  }
  if (activity.kind === "number") {
    const values = answers.map((a) => a.value).sort((a, b) => a - b);
    const mean = total ? values.reduce((sum, v) => sum + v, 0) / total : null;
    const middle = Math.floor(total / 2);
    const median = !total ? null : total % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    return { total, values, mean, median, correctCount };
  }
  return { total };
}

/** Everything, for the host. */
export function hostView(activity) {
  return {
    id: activity.id,
    kind: activity.kind,
    prompt: activity.prompt,
    options: activity.options,
    correct: activity.correct,
    answer: activity.answer,
    tolerance: activity.tolerance,
    status: activity.status,
    startedAt: activity.startedAt,
    responses: [...activity.responses.values()],
    spotlight: activity.spotlight,
  };
}

/**
 * What one student gets: the question, their own answer, and - only once the host has revealed - the right
 * answer, whether they were right, and the class results.
 */
export function studentView(activity, key) {
  const mine = activity.responses.get(key);
  const view = {
    id: activity.id,
    kind: activity.kind,
    prompt: activity.prompt,
    options: activity.options,
    status: activity.status,
    mine: mine ? { value: mine.value, at: mine.at } : null,
    spotlight: activity.spotlight,
  };
  if (activity.status === "revealed") {
    view.correct = activity.correct;
    view.answer = activity.answer;
    view.tolerance = activity.tolerance;
    view.mineCorrect = mine ? mine.correct : null;
    view.results = summarize(activity);
  }
  return view;
}

/* ------------------------------ sockets ------------------------------ */

/** Who a socket is, stable across reconnects: the signed-in account, else the browser's own id. */
export function participantKey(socket) {
  if (socket.data.userId) return `u:${socket.data.userId}`;
  if (socket.data.clientId) return `g:${socket.data.clientId}`;
  return `s:${socket.id}`;
}

function roomSockets(io, roomId) {
  const ids = io.sockets.adapter.rooms.get(roomId);
  const found = [];
  for (const id of ids ?? []) {
    const socket = io.sockets.sockets.get(id);
    if (socket) found.push(socket);
  }
  return found;
}

function payloadFor(socket, roomId) {
  const activity = activities.get(roomId);
  if (!activity) return { role: isHost(socket, roomId) ? "host" : "student", activity: null };
  return isHost(socket, roomId)
    ? { role: "host", activity: hostView(activity) }
    : { role: "student", activity: studentView(activity, participantKey(socket)) };
}

/** Send the current state to one socket (used when someone joins or reconnects). */
export function sendActivityState(socket, roomId) {
  socket.emit("activity-state", payloadFor(socket, roomId));
}

function broadcastState(io, roomId) {
  for (const socket of roomSockets(io, roomId)) socket.emit("activity-state", payloadFor(socket, roomId));
}

/** Forget a room's activity (everyone has left). */
export function releaseActivity(roomId) {
  activities.delete(roomId);
}

/** Test helper */
export function _resetActivities() {
  activities.clear();
}

function allowed(socket) {
  const now = Date.now();
  const bucket = socket.data.activityRate;
  if (!bucket || now > bucket.resetAt) {
    socket.data.activityRate = { count: 1, resetAt: now + 60_000 };
    return true;
  }
  bucket.count++;
  return bucket.count <= ACTIVITY_LIMITS.perMinute;
}

export default function activityEvents(socket, io) {
  const hostOnly = (roomId) => requireHost(socket, roomId);

  socket.on("activity-start", ({ roomId, spec } = {}) => {
    if (!hostOnly(roomId)) return;
    const result = createActivity(spec);
    if (!result.ok) {
      socket.emit("activity-error", { message: result.error });
      return;
    }
    activities.set(roomId, result.activity);
    broadcastState(io, roomId);
  });

  socket.on("activity-close", ({ roomId } = {}) => {
    const activity = activities.get(roomId);
    if (!hostOnly(roomId) || !activity) return;
    closeActivity(activity);
    broadcastState(io, roomId);
  });

  socket.on("activity-reveal", ({ roomId } = {}) => {
    const activity = activities.get(roomId);
    if (!hostOnly(roomId) || !activity) return;
    revealActivity(activity);
    broadcastState(io, roomId);
  });

  socket.on("activity-end", ({ roomId } = {}) => {
    if (!hostOnly(roomId)) return;
    activities.delete(roomId);
    broadcastState(io, roomId);
  });

  // Show one student's drawing to the whole class (the host picks whether the name goes with it)
  socket.on("activity-spotlight", ({ roomId, key, showName } = {}) => {
    const activity = activities.get(roomId);
    if (!hostOnly(roomId) || !activity || activity.kind !== "work") return;
    const response = activity.responses.get(key);
    if (!response) return;
    activity.spotlight = { image: response.value, name: showName === true ? response.name : null, key };
    broadcastState(io, roomId);
  });

  socket.on("activity-spotlight-clear", ({ roomId } = {}) => {
    const activity = activities.get(roomId);
    if (!hostOnly(roomId) || !activity) return;
    activity.spotlight = null;
    broadcastState(io, roomId);
  });

  socket.on("activity-respond", ({ roomId, activityId, value } = {}) => {
    if (typeof roomId !== "string" || !socket.rooms.has(roomId)) return;
    if (isHost(socket, roomId)) return; // the host asks; students answer
    const activity = activities.get(roomId);
    if (!activity || activity.id !== activityId) {
      socket.emit("activity-error", { message: "That question has ended." });
      return;
    }
    if (!allowed(socket)) {
      socket.emit("activity-error", { message: "Slow down a little and try again." });
      return;
    }
    const result = submitResponse(activity, participantKey(socket), socket.data.displayName, value);
    if (!result.ok) {
      socket.emit("activity-error", { message: result.error });
      return;
    }
    socket.emit("activity-ack", { activityId, mine: { value: result.response.value, at: result.response.at } });
    for (const other of roomSockets(io, roomId)) {
      if (isHost(other, roomId)) other.emit("activity-response", { activityId, response: result.response });
    }
  });
}
