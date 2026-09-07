"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export const APP_AUTO_REFRESH_INTERVAL_MS = 5_000;

export function AutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    // TODO(live-updates): Replace this temporary app-wide poll with a durable
    // subscription that replays persisted job events across navigation.
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(refresh, APP_AUTO_REFRESH_INTERVAL_MS);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };

    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [router]);

  return null;
}
