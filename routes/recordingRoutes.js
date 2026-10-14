import express from "express";
import { Transform } from "node:stream";
import { cloudinary } from "../config/cloudinary.js";
import Room from "../models/Room.js";
import SessionRecording from "../models/SessionRecording.js";
import { protect } from "../utils/auth.js";

const router = express.Router();
const MAX_RECORDING_BYTES = 500 * 1024 * 1024;
const MAX_DURATION_SECONDS = 4 * 60 * 60;
const ACCEPTED_FORMATS = new Map([
  ["video/webm", "webm"],
  ["video/mp4", "mp4"],
  ["video/ogg", "ogg"],
]);

router.get("/", protect, async (req, res) => {
  try {
    const recordings = await SessionRecording.find({ owner: req.user._id })
      .populate("room", "topic code")
      .sort({ createdAt: -1 })
      .lean();
    res.json(recordings);
  } catch (error) {
    console.error("Session recording list error:", error);
    res.status(500).json({ message: "Could not load saved recordings." });
  }
});

router.post("/rooms/:roomId", protect, async (req, res) => {
  let uploadedAsset;
  let recordingSaved = false;
  try {
    const room = await Room.findById(req.params.roomId).select("creator topic");
    if (!room) return res.status(404).json({ message: "Room not found." });
    if (room.creator.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Only the room host can save a recording." });
    }

    const mimeType = String(req.headers["content-type"] || "").split(";")[0].toLowerCase();
    const format = ACCEPTED_FORMATS.get(mimeType);
    if (!format) return res.status(415).json({ message: "Recording must be a WebM, MP4, or Ogg video." });

    const durationSeconds = Number(req.headers["x-recording-duration"]);
    if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > MAX_DURATION_SECONDS) {
      return res.status(400).json({ message: "Recording duration is invalid or exceeds four hours." });
    }
    if (Number(req.headers["content-length"]) > MAX_RECORDING_BYTES) {
      return res.status(413).json({ message: "Recording exceeds the 500 MB limit." });
    }

    const titleHeader = req.headers["x-recording-title"];
    let title = "";
    if (typeof titleHeader === "string") {
      try {
        title = decodeURIComponent(titleHeader).trim().slice(0, 120);
      } catch {
        return res.status(400).json({ message: "Recording title is invalid." });
      }
    }
    let bytes = 0;
    const limiter = new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        callback(bytes > MAX_RECORDING_BYTES
          ? new Error("Recording exceeds the 500 MB limit.")
          : null, chunk);
      },
    });

    uploadedAsset = await new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const upload = cloudinary.uploader.upload_chunked_stream(
        { folder: "boardly_recordings", resource_type: "video", format, chunk_size: 6 * 1024 * 1024 },
        (error, result) => {
          if (error) return fail(error);
          if (settled) return;
          settled = true;
          resolve(result);
        }
      );
      limiter.on("error", (error) => {
        req.unpipe(limiter);
        limiter.unpipe(upload);
        upload.destroy();
        req.resume();
        fail(error);
      });
      upload.on("error", fail);
      req.on("error", fail);
      req.pipe(limiter).pipe(upload);
    });
    if (!uploadedAsset?.secure_url || !uploadedAsset?.public_id) {
      throw new Error("Cloudinary did not return a recording URL.");
    }

    const recording = await SessionRecording.create({
      owner: req.user._id,
      room: room._id,
      title: title || room.topic,
      url: uploadedAsset.secure_url,
      publicId: uploadedAsset.public_id,
      format,
      bytes,
      durationSeconds,
    });
    recordingSaved = true;
    res.status(201).json({
      _id: recording._id,
      title: recording.title,
      url: recording.url,
      format: recording.format,
      bytes: recording.bytes,
      durationSeconds: recording.durationSeconds,
      createdAt: recording.createdAt,
    });
  } catch (error) {
    if (error.message === "Recording exceeds the 500 MB limit.") {
      return res.status(413).json({ message: error.message });
    }
    console.error("Session recording upload error:", error);
    if (uploadedAsset?.public_id && !recordingSaved) {
      try {
        await cloudinary.uploader.destroy(uploadedAsset.public_id, { resource_type: "video", type: "upload" });
      } catch (cleanupError) {
        console.error("Orphaned recording cleanup error:", cleanupError);
      }
    }
    res.status(500).json({ message: "Could not save the recording. Keep the local copy and try again." });
  }
});

router.delete("/:recordingId", protect, async (req, res) => {
  try {
    const recording = await SessionRecording.findOne({ _id: req.params.recordingId, owner: req.user._id });
    if (!recording) return res.status(404).json({ message: "Recording not found." });
    await cloudinary.uploader.destroy(recording.publicId, { resource_type: "video", type: "upload" });
    await recording.deleteOne();
    res.sendStatus(204);
  } catch (error) {
    console.error("Session recording delete error:", error);
    res.status(500).json({ message: "Could not delete the recording." });
  }
});

export default router;

export { ACCEPTED_FORMATS, MAX_DURATION_SECONDS, MAX_RECORDING_BYTES };
