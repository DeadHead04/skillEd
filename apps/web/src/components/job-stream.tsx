"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { humanize } from "../lib/labels";

export function JobStream({ jobId }: { jobId?: string }) {
  const [event, setEvent] = useState("Waiting for the worker");
  const router = useRouter();
  useEffect(() => {
    if (!jobId) return;
    const source = new EventSource(`/api/v1/jobs/${jobId}/events`);
    source.onmessage = (message) => {
      const value = JSON.parse(message.data);
      setEvent(humanize(value.data?.stage ?? value.type));
      if (value.type === "completed" || value.type === "failed") {
        source.close();
        router.refresh();
      }
    };
    return () => source.close();
  }, [jobId, router]);
  if (!jobId) return null;
  return (
    <div className="callout" role="status">
      {event}
    </div>
  );
}
