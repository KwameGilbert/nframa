import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { v2 as cloudinary } from "cloudinary";

export type StorageDriver = "local" | "cloudinary";

export interface UploadedFile {
  fileUrl: string;
  storageKey: string;
  storageDriver: StorageDriver;
}

function getDriver(): StorageDriver {
  const driver = process.env.STORAGE_DRIVER ?? "local";
  if (driver !== "local" && driver !== "cloudinary") {
    throw new Error(`Unknown STORAGE_DRIVER: ${driver}. Use "local" or "cloudinary"`);
  }
  return driver;
}

// folder is a `/`-joined path (e.g. "verification/<userId>") kept out of the generated file name so a
// stored file can't collide with another user's, regardless of driver.
export async function uploadFile(
  buffer: Buffer,
  folder: string,
  originalFilename: string,
): Promise<UploadedFile> {
  const driver = getDriver();
  return driver === "cloudinary"
    ? uploadToCloudinary(buffer, folder, originalFilename)
    : uploadToLocal(buffer, folder, originalFilename);
}

// storageDriver is passed explicitly (not read from the current env) so a document uploaded under one
// driver can still be deleted after STORAGE_DRIVER is switched to the other.
export async function deleteFile(storageKey: string, storageDriver: StorageDriver): Promise<void> {
  if (storageDriver === "cloudinary") {
    await cloudinary.uploader.destroy(storageKey, { resource_type: "auto" });
    return;
  }
  await unlink(path.join(localStorageRoot(), storageKey)).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "ENOENT") throw err;
  });
}

function localStorageRoot(): string {
  return process.env.LOCAL_STORAGE_DIR ?? "uploads";
}

async function uploadToLocal(
  buffer: Buffer,
  folder: string,
  originalFilename: string,
): Promise<UploadedFile> {
  const baseUrl = process.env.LOCAL_STORAGE_BASE_URL;
  if (!baseUrl) {
    throw new Error("LOCAL_STORAGE_BASE_URL is not configured");
  }

  const storageKey = `${folder}/${randomUUID()}${path.extname(originalFilename)}`;
  const absolutePath = path.join(localStorageRoot(), storageKey);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer);

  return {
    fileUrl: `${baseUrl}/${storageKey}`,
    storageKey,
    storageDriver: "local",
  };
}

let cloudinaryConfigured = false;

function configureCloudinary(): void {
  if (cloudinaryConfigured) return;

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      "CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET must all be configured",
    );
  }

  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
  cloudinaryConfigured = true;
}

async function uploadToCloudinary(
  buffer: Buffer,
  folder: string,
  originalFilename: string,
): Promise<UploadedFile> {
  configureCloudinary();

  const publicId = `${folder}/${randomUUID()}`;
  const result = await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        resource_type: "auto", // handles images and PDFs alike
        filename_override: originalFilename,
      },
      (err, uploadResult) => {
        if (err || !uploadResult) {
          reject(err ?? new Error("Cloudinary upload returned no result"));
          return;
        }
        resolve(uploadResult);
      },
    );
    uploadStream.end(buffer);
  });

  return {
    fileUrl: result.secure_url,
    storageKey: result.public_id,
    storageDriver: "cloudinary",
  };
}
