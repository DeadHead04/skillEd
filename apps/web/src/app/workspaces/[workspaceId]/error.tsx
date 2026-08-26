"use client";

import { AlertCircle, RotateCcw } from "lucide-react";

export default function WorkspaceError({ reset }: { reset: () => void }) {
  return (
    <main className="page">
      <section className="empty-state" role="alert">
        <AlertCircle size={38} color="var(--red)" />
        <h1>Workspace content could not load</h1>
        <p>
          The request failed safely. Retry it without losing your current
          catalog URL.
        </p>
        <button className="button" onClick={reset}>
          <RotateCcw size={17} /> Retry
        </button>
      </section>
    </main>
  );
}
