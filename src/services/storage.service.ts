import * as cloudinaryService from "./cloudinary.service.js";

export interface UploadedFile {
  fileUrl: string;
  storageKey: string;
}

// folder is a `/`-joined path (e.g. "verification/<userId>") kept out of the generated file name so files
// can't collide, regardless of user.
export async function uploadFile(
  buffer: Buffer,
  folder: string,
  originalFilename: string,
): Promise<UploadedFile> {
  const { fileUrl, publicId } = await cloudinaryService.upload(buffer, folder, originalFilename);
  return { fileUrl, storageKey: publicId };
}

export async function deleteFile(storageKey: string): Promise<void> {
  await cloudinaryService.remove(storageKey);
}
