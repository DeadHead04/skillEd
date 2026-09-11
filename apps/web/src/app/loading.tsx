import { Spinner } from "../components/ui";

export default function Loading() {
  return (
    <div className="work">
      <div className="content">
        <div className="studio-empty" role="status">
          <h2 className="processing-label">
            <Spinner /> Loading your workspace
          </h2>
          <p>Getting the latest details…</p>
          <div className="loading-lines" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
    </div>
  );
}
