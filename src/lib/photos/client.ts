"use client";
import { fitSize } from "./validate";

/** Decodes a picked file. Throws if the file is damaged or not really an image. */
export async function decodePhoto(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new Error("The photo could not be opened (it may be damaged).");
  }
}

/** JPEG copy no larger than `long` px on its longest side (white behind transparent PNGs). */
export async function toJpeg(img: ImageBitmap, long: number, quality = 0.9): Promise<Blob> {
  const { width, height } = fitSize(img.width, img.height, long);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't prepare photos.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not prepare the photo."))), "image/jpeg", quality));
}

export async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
