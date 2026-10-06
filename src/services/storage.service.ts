import { randomUUID } from "node:crypto";
import * as cloudinaryService from "./cloudinary.service.js";
import {
  ATTACHMENT_RESOURCE_TYPE,
  ATTACHMENT_TYPES,
  type AttachmentKind,
} from "../config/supportAttachments.js";
import { safeFileName } from "../utils/fileName.js";

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

export interface StoredAttachment {
  id: string;
  kind: AttachmentKind;
  fileUrl: string;
  thumbnailUrl: string | null;
  storageKey: string;
  resourceType: cloudinaryService.ResourceType;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
}

// A support attachment uploaded from its temp file (see uploadAttachments).
export async function uploadAttachment(
  path: string,
  folder: string,
  { mimeType, fileName, sizeBytes }: { mimeType: string; fileName: string; sizeBytes: number },
): Promise<StoredAttachment> {
  const { kind, ext } = ATTACHMENT_TYPES[mimeType];
  const resourceType = ATTACHMENT_RESOURCE_TYPE[kind];
  const id = randomUUID();
  // Raw files keep their extension in the public id; images and media get theirs from format.
  const publicId = `${BASE_FOLDER}/${folder}/${id}${resourceType === "raw" ? `.${ext}` : ""}`;
  const uploaded = await cloudinaryService.uploadPath(path, {
    publicId,
    resourceType,
    format: kind === "image" ? ext : undefined,
  });

  return {
    id,
    kind,
    fileUrl: uploaded.fileUrl,
    thumbnailUrl: uploaded.thumbnailUrl,
    storageKey: uploaded.publicId,
    resourceType,
    mimeType,
    fileName: safeFileName(fileName, ext),
    sizeBytes,
    durationSeconds: uploaded.durationSeconds,
    width: uploaded.width,
    height: uploaded.height,
  };
}

export async function deleteFile(
  storageKey: string,
  resourceType: cloudinaryService.ResourceType = "image",
): Promise<void> {
  await cloudinaryService.remove(storageKey, resourceType);
}
