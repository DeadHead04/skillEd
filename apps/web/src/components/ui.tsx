import Link from "next/link";
import { resultCopy } from "../lib/labels";

/* -------------------------------------------------------------------------
   Status — colour is never the only carrier. Every state has a glyph and a
   word, so it survives greyscale, colour blindness and a screen reader.
   ------------------------------------------------------------------------- */

const GLYPH: Record<string, string> = {
  pass: "✓",
  partial: "▲",
  fail: "✕",
  error: "○",
  absent: "○",
  active: "●",
};

export function Status({
  value,
  label,
  flaky = false,
}: {
  value: string;
  label?: string;
  flaky?: boolean;
}) {
  const key = String(value).toLowerCase();
  const word = label ?? String(value);
  return (
    <span className={`status ${key}`} title={resultCopy(String(value))}>
      <span className="glyph" aria-hidden="true">
        {GLYPH[key] ?? "·"}
      </span>
      {word}
      {flaky && <span className="flaky">unstable</span>}
    </span>
  );
}

/* -------------------------------------------------------------------------
   Metric cells — one dimension each, with its own numerator and denominator.
   Never combined into a single score.
   ------------------------------------------------------------------------- */

export type MetricValue = {
  key: string;
  label: string;
  passed: number;
  measured: number;
};

export function Metrics({ items }: { items: MetricValue[] }) {
  return (
    <dl className="metrics">
      {items.map((item) => {
        const state =
          item.measured === 0
            ? "unmeasured"
            : item.passed === item.measured
              ? "holds"
              : "broke";
        return (
          <div className={`metric ${state}`} key={item.key}>
            <dt>{item.label}</dt>
            <dd>
              {item.measured === 0 ? (
                <>
                  —<small>not measured</small>
                </>
              ) : (
                <>
                  {item.passed}/{item.measured}
                  <small>
                    {item.passed === item.measured ? "held" : "broke"}
                  </small>
                </>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/* -------------------------------------------------------------------------
   Layout wrappers
   ------------------------------------------------------------------------- */

export function Work({
  inspector,
  children,
}: {
  inspector?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={`work ${inspector ? "with-inspector" : ""}`}>
      <div className="content">{children}</div>
      {inspector}
    </div>
  );
}

export function Verdict({
  title,
  lede,
  status,
  children,
}: {
  title: string;
  lede?: string;
  status?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <>
      <div className="verdict">
        <div>
          <h1>{title}</h1>
          {lede && <p className="lede">{lede}</p>}
        </div>
        {status}
      </div>
      {children}
    </>
  );
}

/* -------------------------------------------------------------------------
   Evidence inspector — the one level deeper. Selection lives in the URL so a
   view is shareable, survives reload, and the back button closes it.
   ------------------------------------------------------------------------- */

export function Inspector({
  title,
  subtitle,
  closeHref,
  tabs,
  children,
}: {
  title: string;
  subtitle?: string;
  closeHref: string;
  tabs?: Array<{ label: string; href: string; on: boolean }>;
  children: React.ReactNode;
}) {
  return (
    <aside className="inspector" aria-label="Evidence">
      <div className="inspector-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <div className="sub">{subtitle}</div>}
        </div>
        <Link className="inspector-close" href={closeHref} aria-label="Close">
          ✕
        </Link>
      </div>
      {tabs && tabs.length > 1 && (
        <nav className="inspector-tabs" aria-label="Evidence sections">
          {tabs.map((tab) => (
            <Link
              key={tab.label}
              href={tab.href}
              className={tab.on ? "on" : ""}
              aria-current={tab.on ? "page" : undefined}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      )}
      <div className="inspector-body">{children}</div>
    </aside>
  );
}

/**
 * File contents. Rendered as text inside a <pre> — an uploaded HTML or script
 * file is shown, never executed.
 */
export function FileView({
  file,
  downloadHref,
}: {
  file: {
    path: string;
    size: number;
    text: string | null;
    binary: boolean;
    truncated: boolean;
  } | null;
  downloadHref?: string;
}) {
  if (!file)
    return (
      <p className="hint">
        This file is not in the stored package, so there is nothing to show.
      </p>
    );
  if (file.binary || file.text === null)
    return (
      <div className="hint">
        <p>
          This is a binary file ({bytes(file.size)}), so it cannot be shown as
          text.
        </p>
        {downloadHref && (
          <p style={{ marginTop: 8 }}>
            <a href={downloadHref}>Download the package to inspect it</a>
          </p>
        )}
      </div>
    );
  return (
    <>
      <pre className="file-view">{file.text}</pre>
      {file.truncated && (
        <p className="hint">Showing the first 1 MB of {bytes(file.size)}.</p>
      )}
    </>
  );
}

export function Assertions({
  assertions,
}: {
  assertions: Array<{
    id?: string;
    dimension?: string;
    passed?: boolean;
    evidence?: string;
    error?: string;
  }>;
}) {
  if (!assertions.length)
    return <p className="hint">No assertions were recorded for this case.</p>;
  return (
    <div>
      {assertions.map((assertion, index) => (
        <div
          className={`assertion ${assertion.passed ? "ok" : "bad"}`}
          key={`${assertion.id ?? index}`}
        >
          <span className="glyph" aria-hidden="true">
            {assertion.passed ? "✓" : "✕"}
          </span>
          <div>
            <p>{assertion.id ?? assertion.dimension ?? "Assertion"}</p>
            {(assertion.evidence || assertion.error) && (
              <div className="evidence">
                {assertion.error ?? assertion.evidence}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Additions and deletions are marked with a sign as well as a colour. */
export function DiffViewer({ patch }: { patch: string }) {
  const lines = String(patch).split("\n");
  return (
    <pre className="diff" aria-label="File changes">
      {lines.map((line, index) => {
        const kind = line.startsWith("+++")
          ? "meta"
          : line.startsWith("---")
            ? "meta"
            : line.startsWith("@@")
              ? "meta"
              : line.startsWith("+")
                ? "add"
                : line.startsWith("-")
                  ? "del"
                  : "";
        return (
          <div className={kind} key={index}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

export function bytes(value: number) {
  if (!Number.isFinite(value)) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
