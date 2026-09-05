"use client";
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="work">
      <div className="content">
        <div className="error-box" role="alert">
          <h2>The workbench could not load</h2>
          <p>{error.message}</p>
          <button className="btn" onClick={reset}>
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
