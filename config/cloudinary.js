// config/cloudinary.js
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import dotenv from "dotenv";
dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Storage for PDFs
const pdfStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "tutorhub_pdfs",
    resource_type: "raw",
    allowed_formats: ["pdf"],
  },
});

// Storage for images (avatars)
const imageStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "tutorhub_avatars",
    resource_type: "image",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
  },
});

export { cloudinary, pdfStorage, imageStorage };
