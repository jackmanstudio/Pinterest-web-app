"use client";
import { EXPORT_SIZES, placeImage, type ExportSizeId, type FitMode } from "@/lib/tools/resize";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read the image."));
    img.src = src;
  });
}

/** Re-renders a pin image at another size in the browser (nothing is uploaded). */
export async function resizeImage(url: string, sizeId: ExportSizeId, mode: FitMode): Promise<Blob> {
  const size = EXPORT_SIZES.find((s) => s.id === sizeId)!;
  // Read through a blob URL so the canvas stays exportable for signed and data URLs alike.
  const blob = await (await fetch(url)).blob();
  const local = URL.createObjectURL(blob);
  try {
    const img = await loadImage(local);
    const src = { width: img.naturalWidth || 1000, height: img.naturalHeight || 1500 };
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d")!;
    if (mode === "fit") {
      const back = placeImage(src, size, "fill");
      ctx.filter = "blur(28px) brightness(0.85)";
      ctx.drawImage(img, back.x - 40, back.y - 40, back.w + 80, back.h + 80);
      ctx.filter = "none";
    }
    const r = placeImage(src, size, mode);
    ctx.drawImage(img, r.x, r.y, r.w, r.h);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not export the image."))), "image/jpeg", 0.9));
  } finally {
    URL.revokeObjectURL(local);
  }
}
