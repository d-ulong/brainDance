import { createHash } from "node:crypto";

import sharp from "sharp";

import {
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  type AllowedMediaMime,
} from "@/modules/family-content/constants";
import { FamilyContentError } from "@/modules/family-content/errors";

export type ReencodedImage = {
  bytes: Buffer;
  mime: AllowedMediaMime;
  width: number;
  height: number;
  sha256: string;
};

export async function reencodeSafeImage(
  input: Buffer,
  detectedMime: AllowedMediaMime,
): Promise<ReencodedImage> {
  try {
    const pipeline = sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
    }).rotate();

    const meta = await pipeline.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width <= 0 || height <= 0) {
      throw new FamilyContentError("MEDIA_REJECTED", "Image decode failed");
    }
    if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
      throw new FamilyContentError("MEDIA_REJECTED", "Image dimensions exceed limit");
    }
    if (width * height > MAX_IMAGE_PIXELS) {
      throw new FamilyContentError("MEDIA_REJECTED", "Image pixel count exceeds limit");
    }

    let output: Buffer;
    let mime: AllowedMediaMime;
    if (detectedMime === "image/jpeg") {
      output = await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
      mime = "image/jpeg";
    } else if (detectedMime === "image/png") {
      output = await pipeline.png({ compressionLevel: 9 }).toBuffer();
      mime = "image/png";
    } else {
      output = await pipeline.webp({ quality: 85 }).toBuffer();
      mime = "image/webp";
    }

    const outMeta = await sharp(output, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
    return {
      bytes: output,
      mime,
      width: outMeta.width ?? width,
      height: outMeta.height ?? height,
      sha256: createHash("sha256").update(output).digest("hex"),
    };
  } catch (error) {
    if (error instanceof FamilyContentError) {
      throw error;
    }
    throw new FamilyContentError("MEDIA_REJECTED", "Image re-encode failed");
  }
}
