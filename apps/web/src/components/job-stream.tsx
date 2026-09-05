"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../lib/client-request";
import { humanize } from "../lib/labels";

export function JobStream({ jobId }: { jobId?: string }) {
  const [event, setEvent] = useState("Waiting for the worker");
  const router = useRouter();
  useEffect(() => {
    if (!jobId) return;
    const source = new EventSource(`/api/v1/jobs/${jobId}/events`);
    source.onerror = () =>
      setEvent("Connection interrupted. Reconnecting to saved progress…");
    source.onmessage = (message) => {
      const value = JSON.parse(message.data);
      setEvent(humanize(value.data?.stage ?? value.type));
      if (
        ["completed", "failed", "cancelled", "interrupted"].includes(value.type)
      ) {
        source.close();
        router.refresh();
      }
    };
    return () => source.close();
  }, [jobId, router]);
  if (!jobId) return null;
  return (
    <div className="job-stream" role="status">
      <span>{event}</span>
      <button
        className="btn quiet"
        type="button"
        onClick={async () => {
          const response = await apiFetch(`/api/v1/jobs/${jobId}/cancel`, {
            method: "POST",
          });
          setEvent(
            response.ok
              ? "Cancellation requested"
              : "Cancellation could not be sent. Retry.",
          );
        }}
      >
        Cancel operation
      </button>
    </div>
  );
}
