"use client";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

/**
 * A Link that doesn't prefetch every page it can see on load (that was most of the
 * dashboard's JavaScript work). It prefetches when the pointer or a finger reaches it,
 * which is still well before the click.
 */
export default function Link({ href, onMouseEnter, onTouchStart, onFocus, ...rest }: ComponentProps<typeof NextLink>) {
  const router = useRouter();
  const warm = () => {
    if (typeof href === "string") router.prefetch(href);
  };
  return (
    <NextLink
      href={href}
      prefetch={false}
      onMouseEnter={(e) => {
        warm();
        onMouseEnter?.(e);
      }}
      onTouchStart={(e) => {
        warm();
        onTouchStart?.(e);
      }}
      onFocus={(e) => {
        warm();
        onFocus?.(e);
      }}
      {...rest}
    />
  );
}
