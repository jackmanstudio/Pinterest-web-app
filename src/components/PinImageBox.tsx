/**
 * Every pin image in the app uses this one box: 2:3 and 220 px wide (never
 * wider), so pins look the same size on every screen. Only the hero/preview
 * areas use their own sizes.
 */
export const PIN_BOX = "relative mx-auto aspect-[2/3] w-full max-w-[220px] shrink-0 overflow-hidden rounded-lg bg-zinc-100";
/** Grid for cards that hold one pin image each: columns never narrower than the pin. */
export const PIN_GRID = "grid gap-4 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]";

export function PinImageBox({ src, alt, children, referrerPolicy }: { src?: string | null; alt?: string; children?: React.ReactNode; referrerPolicy?: React.HTMLAttributeReferrerPolicy }) {
  return (
    <div className={PIN_BOX}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed/data/CDN URLs, not optimisable
        <img src={src} alt={alt ?? ""} className="h-full w-full object-cover" referrerPolicy={referrerPolicy} loading="lazy" />
      ) : (
        children
      )}
    </div>
  );
}
