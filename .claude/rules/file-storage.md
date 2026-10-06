---
paths:
  - "src/services/storage*"
  - "src/services/cloudinary*"
  - "src/middlewares/upload.ts"
  - "src/**/verification*"
---

# File storage

Uploaded files (currently: driver verification documents) go through `src/services/storage.service.ts`, a thin wrapper over `src/services/cloudinary.service.ts` — nothing else in the app should call the Cloudinary SDK directly. `uploadFile(buffer, folder, originalFilename)` returns `{ fileUrl, storageKey }`: `fileUrl` is Cloudinary's real `secure_url`, stored as-is and returned to clients; `storageKey` (Cloudinary's `public_id`) is internal-only, kept off every response the same way `UserModel` excludes `passwordHash` (see `VerificationDocumentModel.excludedColumns`, and its `PUBLIC_COLUMNS` for the custom queries that bypass `sanitize()`), used only to delete the file later via `deleteFile(storageKey)`. Needs `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`. Uploads via `upload_stream` with `resource_type: "auto"` so both images and PDFs work — all files live under the `nframa/` folder in the Cloudinary account, since the account isn't dedicated to this app.

**Required Cloudinary account setting:** `resource_type: "auto"` classifies PDFs under the `image` delivery type, and Cloudinary blocks public delivery of PDF/ZIP files by default on that type (a 2024 security default — PDFs can carry embedded JS). Without changing this, every PDF verification document 404s/401s when opened, even though the upload itself succeeds. Fix once per Cloudinary account: **Console → Settings → Security → check "Allow delivery of PDF and ZIP files"**. JPEG/PNG/WEBP documents are unaffected either way.

Uploads arrive as `multipart/form-data`, not JSON — `src/middlewares/upload.ts` wraps `multer` (memory storage, 10MB limit, JPEG/PNG/WEBP/PDF only) and converts its errors to `AppError` so they reach `errorHandler` like any other 400, instead of an unhandled 500. It runs before `validate()` on routes that accept a file, since `express.json()` skips multipart bodies entirely — multer is what parses them.

Vehicle photos (`uploadImageFields(VEHICLE_PHOTO_SIDES)`, one image per side, all four required on `POST /vehicles`, one replaced with `PUT /vehicles/:id/photos/:side`) keep public URLs in `vehicles.photos` and storage keys in `vehicles.photoKeys`, which `vehicleModel` lists in `excludedColumns` so no response carries them. Uploads happen before the insert and are deleted if it fails; a replaced photo's old file is deleted after the commit (the row lock hands each replacement the key it replaced).

Support attachments are different: `uploadAttachments()` writes to temp files (`multer.diskStorage`, removed when the response closes) because videos reach 50MB, and `storage.uploadAttachment` uploads with an explicit Cloudinary `resource_type` (`image`, `video` for video and audio, `raw` for documents). `destroy()` rejects `"auto"`, so `deleteFile(storageKey, resourceType)` must get the type the file was stored as (default `image`, which is how the older `auto` uploads of images and PDFs were stored). See `support.md`.

Tests never hit Cloudinary: `tests/setup.ts` mocks `storage.service.js` the same way it mocks SMS/email, returning a fake-but-real-shaped URL built from the actual inputs.
