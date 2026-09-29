import * as cloudinaryService from "./cloudinary.service.js";

export interface UploadedFile {
  fileUrl: string;
  storageKey: string;
}

// Every upload lives under this Cloudinary folder, regardless of caller — the account (kwamegilbert) isn't
// dedicated to this app, so this keeps Nframa's files namespaced away from anything else in it.
const BASE_FOLDER = "nframa";

// folder is a `/`-joined path under BASE_FOLDER (e.g. "verification/<userId>") kept out of the generated
// file name so files can't collide, regardless of user.
export async function uploadFile(
  buffer: Buffer,
  folder: string,
  originalFilename: string,
): Promise<UploadedFile> {
  const { fileUrl, publicId } = await cloudinaryService.upload(
    buffer,
    `${BASE_FOLDER}/${folder}`,
    originalFilename,
  );
  return { fileUrl, storageKey: publicId };
}

export async function deleteFile(storageKey: string): Promise<void> {
  await cloudinaryService.remove(storageKey);
}
