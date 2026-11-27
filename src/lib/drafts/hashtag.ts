/** "women's fashion" → "#womensfashion". Keeps letters (any script, with their marks), digits and _ only. */
export function toHashtag(tag: string): string {
  const body = tag.normalize("NFC").replace(/[^\p{L}\p{M}\p{N}_]/gu, "");
  return body ? `#${body}` : "";
}
