import express from "express";
import multer from "multer";
import { Readable } from "node:stream";
import { cloudinary } from "../config/cloudinary.js";
import Room from "../models/Room.js";
import { protect } from "../utils/auth.js";

const router = express.Router();
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const ACCEPTED_TYPES = new Map([
  ["image/jpeg", "image"],
  ["image/png", "image"],
  ["image/webp", "image"],
  ["image/gif", "image"],
  ["video/mp4", "video"],
  ["video/webm", "video"],
  ["video/quicktime", "video"],
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!ACCEPTED_TYPES.has(file.mimetype)) {
      callback(new Error("Choose a JPG, PNG, WEBP, GIF, MP4, WEBM or MOV file."));
      return;
    }
    callback(null, true);
  },
});

function acceptUpload(req, res, next) {
  upload.single("media")(req, res, (error) => {
    if (error) {
      return res.status(error instanceof multer.MulterError ? 400 : 415).json({
        message: error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
          ? "Media files must be 100 MB or smaller."
          : error.message,
      });
    }
    next();
  });
}

function uploadToCloudinary(file, resourceType) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "boardly_media", resource_type: resourceType },
      (error, result) => error ? reject(error) : resolve(result)
    );
    Readable.from([file.buffer]).pipe(stream);
  });
}

router.post("/board/:roomId", protect, acceptUpload, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Choose an image or video to upload." });
    }

    const room = await Room.findById(req.params.roomId);
    if (!room) return res.status(404).json({ message: "Room not found." });
    if (room.creator.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Only the room host can upload board media." });
    }

    const mediaType = ACCEPTED_TYPES.get(req.file.mimetype);
    const result = await uploadToCloudinary(req.file, mediaType);
    if (!result?.secure_url) {
      throw new Error("Cloudinary did not return a media URL.");
    }

    return res.status(201).json({
      success: true,
      media: {
        src: result.secure_url,
        mediaType,
        mimeType: req.file.mimetype,
        filename: req.file.originalname,
        width: result.width,
        height: result.height,
      },
    });
  } catch (error) {
    console.error("Board media upload error:", error);
    return res.status(500).json({ message: "Media upload failed. Please try again." });
  }
});

export default router;
