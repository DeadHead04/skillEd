"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function InspectorFocus({
  closeHref,
  children,
}: {
  closeHref: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null),
    router = useRouter();
  useEffect(() => {
    ref.current?.focus({ preventScroll: false });
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        router.push(closeHref);
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [closeHref, router]);
  return (
    <aside ref={ref} tabIndex={-1} className="inspector" aria-label="Evidence">
      {children}
    </aside>
  );
}
