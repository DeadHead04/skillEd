"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** The proposal may finish between its record read and the active-job read.
 * Recover from durable state even when there is no remaining job to stream. */
export function ProposalRecovery({
  id,
  status,
}: {
  id: string;
  status: string;
}) {
  const router = useRouter();
  const [interrupted, setInterrupted] = useState(false);
  const active = ["generating", "verifying"].includes(status);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/v1/improve/${id}`, {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10_000),
          ]),
        });
        if (!response.ok) throw new Error("Proposal status unavailable");
        const value = await response.json();
        if (controller.signal.aborted) return;
        setInterrupted(false);
        if (value.status !== status) router.refresh();
      } catch {
        if (!controller.signal.aborted) setInterrupted(true);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 3000);
      }
    };
    timer = setTimeout(poll, 1000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [active, id, status, router]);
  if (!active) return null;
  return (
    <p className="hint" role="status">
      {interrupted
        ? "Connection interrupted. Retrying saved progress…"
        : "Checking saved progress. You can safely refresh this page."}
    </p>
  );
}
