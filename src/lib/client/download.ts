/** Saves text or a blob as a file in the browser. CSV text gets a UTF-8 BOM so Excel reads Urdu/Arabic correctly. */
export function downloadFile(name: string, content: string | Blob, type = "text/csv;charset=utf-8") {
  const blob = content instanceof Blob ? content : new Blob([`﻿${content}`], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** File name for a pin image, from its title. */
export function pinFileName(title: string, ext = "jpg"): string {
  return `${title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "pin"}.${ext}`;
}

/** Downloads an image URL (signed URL or data URL) under the pin's name. */
export async function downloadImage(url: string, title: string) {
  const blob = await (await fetch(url)).blob();
  const ext = blob.type.includes("png") ? "png" : blob.type.includes("svg") ? "svg" : "jpg";
  downloadFile(pinFileName(title, ext), blob);
}
