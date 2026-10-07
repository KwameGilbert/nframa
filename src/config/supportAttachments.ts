import type { ResourceType } from "../services/cloudinary.service.js";

export type AttachmentKind = "image" | "video" | "audio" | "document";

const MB = 1024 * 1024;

// What a support message can carry. ext is the stored file's extension (raw files keep it in their public id,
// which is what makes them download with the right type).
export const ATTACHMENT_TYPES: Record<string, { kind: AttachmentKind; ext: string }> = {
  "image/jpeg": { kind: "image", ext: "jpg" },
  "image/png": { kind: "image", ext: "png" },
  "image/webp": { kind: "image", ext: "webp" },
  "image/heic": { kind: "image", ext: "jpg" }, // iPhone photos, converted so every client can show them
  "image/heif": { kind: "image", ext: "jpg" },
  "video/mp4": { kind: "video", ext: "mp4" },
  "video/quicktime": { kind: "video", ext: "mov" },
  "video/webm": { kind: "video", ext: "webm" },
  "video/3gpp": { kind: "video", ext: "3gp" },
  "audio/mp4": { kind: "audio", ext: "m4a" },
  "audio/x-m4a": { kind: "audio", ext: "m4a" },
  "audio/m4a": { kind: "audio", ext: "m4a" },
  "audio/aac": { kind: "audio", ext: "aac" },
  "audio/mpeg": { kind: "audio", ext: "mp3" },
  "audio/ogg": { kind: "audio", ext: "ogg" },
  "audio/webm": { kind: "audio", ext: "webm" },
  "audio/wav": { kind: "audio", ext: "wav" },
  "audio/x-wav": { kind: "audio", ext: "wav" },
  "application/pdf": { kind: "document", ext: "pdf" },
  "application/msword": { kind: "document", ext: "doc" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    kind: "document",
    ext: "docx",
  },
  "application/vnd.ms-excel": { kind: "document", ext: "xls" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    kind: "document",
    ext: "xlsx",
  },
  "text/plain": { kind: "document", ext: "txt" },
  "text/csv": { kind: "document", ext: "csv" },
};

export const ATTACHMENT_MAX_BYTES: Record<AttachmentKind, number> = {
  image: 10 * MB,
  video: 50 * MB,
  audio: 16 * MB,
  document: 10 * MB,
};

// Cloudinary keeps audio under "video"; documents are "raw". Uploading with an explicit type (not "auto") makes
// Cloudinary refuse a file that isn't what its MIME type claims.
export const ATTACHMENT_RESOURCE_TYPE: Record<AttachmentKind, ResourceType> = {
  image: "image",
  video: "video",
  audio: "video",
  document: "raw",
};

export const ALLOWED_ATTACHMENTS_TEXT =
  "images (JPEG, PNG, WEBP, HEIC), videos (MP4, MOV, WEBM, 3GP), audio (M4A, AAC, MP3, OGG, WEBM, WAV) and documents (PDF, Word, Excel, TXT, CSV)";

export const MAX_ATTACHMENTS = 5;
export const MESSAGE_DELETE_WINDOW_MINUTES = 15;
