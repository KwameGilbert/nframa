import { randomUUID } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";

let configured = false;

function configure(): void {
  if (configured) return;

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      "CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET must all be configured",
    );
  }

  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
  configured = true;
}

export async function upload(
  buffer: Buffer,
  folder: string,
  originalFilename: string,
): Promise<{ fileUrl: string; publicId: string }> {
  configure();

  const publicId = `${folder}/${randomUUID()}`;
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        resource_type: "auto", // handles images and PDFs alike
        filename_override: originalFilename,
      },
      (err, result) => {
        if (err || !result) {
          reject(err ?? new Error("Cloudinary upload failed"));
          return;
        }
        resolve({ fileUrl: result.secure_url, publicId: result.public_id });
      },
    );
    uploadStream.end(buffer);
  });
}

export type ResourceType = "image" | "video" | "raw";

export interface UploadedPath {
  fileUrl: string;
  publicId: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

// From a temp file on disk, with the exact resource type: Cloudinary then refuses a file that isn't what its
// type claims. format converts on upload (HEIC photos are stored as JPEG).
export async function uploadPath(
  path: string,
  { publicId, resourceType, format }: { publicId: string; resourceType: ResourceType; format?: string },
): Promise<UploadedPath> {
  configure();

  const result = await cloudinary.uploader.upload(path, {
    public_id: publicId,
    resource_type: resourceType,
    ...(format ? { format } : {}),
  });
  // A video's poster frame (audio has no picture, so no thumbnail).
  const thumbnailUrl =
    resourceType === "video" && result.width
      ? cloudinary.url(result.public_id, { resource_type: "video", format: "jpg", secure: true })
      : null;

  return {
    fileUrl: result.secure_url,
    publicId: result.public_id,
    thumbnailUrl,
    width: result.width ?? null,
    height: result.height ?? null,
    durationSeconds: typeof result.duration === "number" ? Math.round(result.duration) : null,
  };
}

// destroy() doesn't accept "auto": it needs the type the file was stored as. Uploads with "auto" store images
// and PDFs as "image", hence the default.
export async function remove(publicId: string, resourceType: ResourceType = "image"): Promise<void> {
  configure();
  await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}
