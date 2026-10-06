import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import multer, { MulterError } from "multer";
import type { NextFunction, Request, Response } from "express";
import {
  ALLOWED_ATTACHMENTS_TEXT,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_TYPES,
  MAX_ATTACHMENTS,
} from "../config/supportAttachments.js";
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

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB each
const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Up to maxCount images in one multipart request, under the same field name (a report's evidence). Images only,
// unlike uploadSingleFile. A JSON request passes straight through with no files: express.json() caps bodies at
// 100kb, far too small for photos, so images only travel as multipart. Files land in req.files.
export function uploadImages(fieldName: string, maxCount: number) {
  const images = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: maxCount },
    fileFilter: (_req, file, cb) => {
      if (!IMAGE_MIME_TYPES.includes(file.mimetype)) {
        cb(AppError.badRequest(`Unsupported file type: ${file.mimetype}. Allowed: JPEG, PNG, WEBP`));
        return;
      }
      cb(null, true);
    },
  }).array(fieldName, maxCount);

  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.is("multipart/form-data")) {
      next();
      return;
    }

    images(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof MulterError) {
        const tooMany = err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE";
        const message =
          err.code === "LIMIT_FILE_SIZE"
            ? `Image too large. Maximum size is ${MAX_IMAGE_BYTES / (1024 * 1024)}MB each`
            : tooMany
              ? `You can attach up to ${maxCount} images, under the '${fieldName}' field`
              : err.message;
        next(AppError.badRequest(message));
        return;
      }
      next(err);
    });
  };
}

const LARGEST_ATTACHMENT = Math.max(...Object.values(ATTACHMENT_MAX_BYTES));
const KIND_PLURAL = { image: "Images", video: "Videos", audio: "Audio files", document: "Documents" };

// Support message attachments (images, video, voice notes, documents) in one multipart request, under the same
// field. Written to temp files, not memory: five 50MB videos per request would sink a small host. The temp files
// are removed once the response ends, whatever happened. JSON passes straight through with no files.
export function uploadAttachments(fieldName = "attachments", maxCount = MAX_ATTACHMENTS) {
  const attachments = multer({
    storage: multer.diskStorage({ destination: tmpdir() }),
    limits: { fileSize: LARGEST_ATTACHMENT, files: maxCount },
    fileFilter: (_req, file, cb) => {
      if (!ATTACHMENT_TYPES[file.mimetype]) {
        cb(
          AppError.badRequest(
            `Unsupported file type: ${file.mimetype}. Allowed: ${ALLOWED_ATTACHMENTS_TEXT}`,
          ),
        );
        return;
      }
      cb(null, true);
    },
  }).array(fieldName, maxCount);

  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.is("multipart/form-data")) {
      next();
      return;
    }
    res.on("close", () => {
      const files = (req.files ?? []) as Express.Multer.File[];
      for (const file of files) void rm(file.path, { force: true }).catch(() => undefined);
    });

    attachments(req, res, (err: unknown) => {
      if (err instanceof MulterError) {
        const tooMany = err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE";
        const message =
          err.code === "LIMIT_FILE_SIZE"
            ? `File too large. Maximum size is ${LARGEST_ATTACHMENT / (1024 * 1024)}MB`
            : tooMany
              ? `You can attach up to ${maxCount} files, under the '${fieldName}' field`
              : err.message;
        next(AppError.badRequest(message));
        return;
      }
      if (err) {
        next(err);
        return;
      }
      for (const file of (req.files ?? []) as Express.Multer.File[]) {
        const { kind } = ATTACHMENT_TYPES[file.mimetype];
        if (file.size > ATTACHMENT_MAX_BYTES[kind]) {
          next(
            AppError.badRequest(
              `${KIND_PLURAL[kind]} can be at most ${ATTACHMENT_MAX_BYTES[kind] / (1024 * 1024)}MB each`,
            ),
          );
          return;
        }
      }
      next();
    });
  };
}
