import multer, { MulterError } from "multer";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/AppError.js";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

// Memory storage, not disk: the buffer goes straight to storage.service.ts (local write or Cloudinary
// upload) without ever touching a temp file on this server.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(
        new AppError(`Unsupported file type: ${file.mimetype}. Allowed: JPEG, PNG, WEBP, PDF`, 400),
      );
      return;
    }
    cb(null, true);
  },
});

// Wraps multer's own middleware so its errors (file too large, wrong field name) become AppErrors instead
// of an unhandled 500 — multer calls next(err) with a MulterError that errorHandler.ts doesn't recognize.
export function uploadSingleFile(fieldName: string) {
  const middleware = upload.single(fieldName);

  return (req: Request, res: Response, next: NextFunction) => {
    middleware(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof MulterError) {
        const message =
          err.code === "LIMIT_FILE_SIZE"
            ? `File too large. Maximum size is ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`
            : err.message;
        next(AppError.badRequest(message));
        return;
      }
      next(err);
    });
  };
}
