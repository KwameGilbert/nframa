import multer, { MulterError } from "multer";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/AppError.js";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

// Base64 data URI pattern: data:image/png;base64,...
const BASE64_PATTERN = /^data:(image\/jpeg|image\/png|image\/webp|application\/pdf);base64,(.+)$/;

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

// Handles both file uploads (multipart/form-data) and base64 strings (application/json).
// For multipart: file is in req.file as usual (field name must match fieldName param).
// For base64 JSON: body must have fieldName with value "data:image/...;base64,..." or raw base64 string.
// Normalizes both to req.file format so controllers don't need to care about the source.
// If neither is present, just passes through - the field is optional.
export function uploadSingleFile(fieldName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // If content-type is multipart/form-data, use multer to parse the file
    if (req.is("multipart/form-data")) {
      const middleware = upload.single(fieldName);
      return middleware(req, res, (err: unknown) => {
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
    }

    // If content-type is application/json, check if base64 is being provided
    if (req.is("application/json")) {
      const base64String = (req.body as Record<string, unknown>)?.[fieldName];

      // If no field provided, it's optional - just proceed
      if (!base64String) {
        return next();
      }

      if (typeof base64String !== "string") {
        return next(AppError.badRequest(`${fieldName} must be a string`));
      }

      // Try to parse as data URI: data:mime/type;base64,...
      const match = BASE64_PATTERN.exec(base64String);
      let mimeType: string;
      let base64Data: string;

      if (match) {
        [, mimeType, base64Data] = match;
      } else {
        // Assume raw base64 without data URI prefix; default to JPEG
        mimeType = "image/jpeg";
        base64Data = base64String;
      }

      // Validate MIME type
      if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
        return next(
          AppError.badRequest(
            `Unsupported file type: ${mimeType}. Allowed: JPEG, PNG, WEBP, PDF`,
          ),
        );
      }

      // Decode base64 to buffer
      let buffer: Buffer;
      try {
        buffer = Buffer.from(base64Data, "base64");
      } catch {
        return next(AppError.badRequest("Invalid base64 encoding"));
      }

      // Check file size
      if (buffer.length > MAX_FILE_SIZE_BYTES) {
        return next(
          AppError.badRequest(
            `File too large. Maximum size is ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`,
          ),
        );
      }

      // Construct a fake Express.Multer.File object to match the multipart format
      const ext = mimeType.split("/")[1] || "bin";
      const filename = `${Date.now()}.${ext}`;

      (req as unknown as Record<string, unknown>).file = {
        fieldname: fieldName,
        originalname: filename,
        encoding: "base64",
        mimetype: mimeType,
        buffer,
        size: buffer.length,
      } as Express.Multer.File;

      return next();
    }

    // For other content types, try multer anyway (it will handle if it's form data)
    const middleware = upload.single(fieldName);
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
