"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiAction } from "./actions";

/** A recheck only reads readiness. It never queues another model operation. */
export function ExecutionAction({
  availability,
  ...action
}: {
  availability: { available: boolean; code: string; detail: string };
  url: string;
  label: string;
  body?: unknown;
}) {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  if (availability.available) return <ApiAction {...action} />;
  async function recheck() {
    setChecking(true);
    setError("");
    try {
      const response = await fetch("/api/v1/execution-readiness", {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok)
        throw new Error(
          "Readiness check unavailable. Try again when the connection returns.",
        );
      const current = await response.json();
      if (!current.available) setError(current.detail);
      router.refresh();
    } catch {
      setError(
        "Readiness check unavailable. Try again when the connection returns.",
      );
    } finally {
      setChecking(false);
    }
  }
  return (
    <div>
      <p className="error-box" role="status">
        {error || availability.detail}
      </p>
      <p className="hint">
        Your draft is preserved. An administrator must resolve execution setup
        before generation can continue.
      </p>
      <button
        type="button"
        className="btn secondary"
        disabled={checking}
        onClick={recheck}
      >
        {checking ? "Checking readiness…" : "Recheck execution"}
      </button>{" "}
      <Link className="btn quiet" href="/diagnostics">
        Administrator diagnostics
      </Link>
    </div>
  );
}
