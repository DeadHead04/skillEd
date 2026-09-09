"use client";
import Link from "next/link";
export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="work">
      <div className="content">
        <div className="error-box" role="alert">
          <h2>The workspace could not load</h2>
          <p>Try again, or return to your dashboard to continue.</p>
          <div className="decision-actions">
            <button className="btn" onClick={reset}>
              Try again
            </button>
            <Link className="btn secondary" href="/dashboard">
              Dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
