import type { GeneratedImage, ImageProvider } from "./types";

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function wrap(text: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if ((line + " " + word).trim().length > width) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else line = (line + " " + word).trim();
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && text.length > lines.join(" ").length) lines[maxLines - 1] += "…";
  return lines;
}

/**
 * Placeholder "image" used until a real image provider is configured. The SVG
 * carries a large DEMO banner so it can't be mistaken for generated art.
 */
export class DemoImageProvider implements ImageProvider {
  readonly name = "Demo placeholder (no AI)";
  readonly source = "demo" as const;

  async generate(prompt: string, size: { width: number; height: number }): Promise<GeneratedImage> {
    const h = hash(prompt);
    const hue1 = h % 360;
    const hue2 = (hue1 + 40 + ((h >> 9) % 80)) % 360;
    const lines = wrap(prompt, 34, 12);
    const text = lines
      .map((l, i) => `<text x="80" y="${560 + i * 56}" font-size="40" fill="#fff" font-family="system-ui, sans-serif">${esc(l)}</text>`)
      .join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 1000 1500">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue1},55%,42%)"/><stop offset="1" stop-color="hsl(${hue2},60%,28%)"/></linearGradient></defs>
<rect width="1000" height="1500" fill="url(#g)"/>
<rect x="0" y="120" width="1000" height="200" fill="#fde68a"/>
<text x="500" y="250" font-size="96" font-weight="800" text-anchor="middle" fill="#78350f" font-family="system-ui, sans-serif">DEMO IMAGE</text>
<text x="80" y="470" font-size="34" fill="#fde68a" font-family="system-ui, sans-serif">Placeholder, not AI. Prompt:</text>
${text}
</svg>`;
    return {
      bytes: new TextEncoder().encode(svg),
      contentType: "image/svg+xml",
      extension: "svg",
      source: "demo",
      provider: this.name,
      model: null,
      est_cost_usd: 0,
    };
  }
}
