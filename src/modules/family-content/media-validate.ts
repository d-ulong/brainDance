import {
  ALLOWED_MIMES,
  MAX_MEDIA_BYTES,
  type AllowedMediaMime,
} from "@/modules/family-content/constants";
import { FamilyContentError } from "@/modules/family-content/errors";

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function detectImageMimeFromMagic(bytes: Buffer): AllowedMediaMime | null {
  if (bytes.length < 12) {
    return null;
  }
  if (bytes.subarray(0, 3).equals(JPEG_MAGIC)) {
    return "image/jpeg";
  }
  if (bytes.subarray(0, 8).equals(PNG_MAGIC)) {
    return "image/png";
  }
  // RIFF....WEBP
  if (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function normalizeDeclaredMime(declaredMime: string): AllowedMediaMime {
  const normalized = declaredMime.trim().toLowerCase();
  const alias =
    normalized === "image/jpg" ? "image/jpeg" : (normalized as AllowedMediaMime | string);
  if (!(ALLOWED_MIMES as readonly string[]).includes(alias)) {
    throw new FamilyContentError("VALIDATION_ERROR", "Unsupported media type");
  }
  return alias as AllowedMediaMime;
}

export function assertUploadSize(byteLength: number): void {
  if (byteLength <= 0) {
    throw new FamilyContentError("VALIDATION_ERROR", "Empty media upload");
  }
  if (byteLength > MAX_MEDIA_BYTES) {
    throw new FamilyContentError("VALIDATION_ERROR", "Media exceeds 10 MiB limit");
  }
}

export function assertDeclaredMatchesDetected(
  declaredMime: AllowedMediaMime,
  detectedMime: AllowedMediaMime,
): void {
  if (declaredMime !== detectedMime) {
    throw new FamilyContentError("VALIDATION_ERROR", "Declared MIME does not match file content");
  }
}
