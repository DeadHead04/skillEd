"use client";
import { useState } from "react";
import { apiFetch } from "../lib/client-request";
import { Spinner } from "./processing";
function csvRows(text: string) {
  const rows: string[][] = [],
    row: string[] = [];
  let field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(field);
      field = "";
    } else if (c === "\n" && !quoted) {
      row.push(field.replace(/\r$/, ""));
      rows.push([...row]);
      row.length = 0;
      field = "";
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}
export function ArtifactPreview({
  runId,
  artifacts,
}: {
  runId: string;
  artifacts: Array<{ key: string; size: number }>;
}) {
  const [selected, setSelected] = useState(""),
    [content, setContent] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function preview(key: string) {
    setSelected(key);
    setContent(null);
    setError("");
    setBusy(true);
    try {
      const response = await apiFetch(
        `/api/v1/runs/${runId}/artifact?preview=1&key=${encodeURIComponent(key)}`,
      );
      const data = await response.json();
      if (!response.ok) setError(data.detail ?? "Preview unavailable");
      else setContent(data.text);
    } catch {
      setError("Connection lost. Select the file again to retry.");
    } finally {
      setBusy(false);
    }
  }
  const rows =
    content !== null && /\.csv$/i.test(selected) ? csvRows(content) : null;
  return (
    <div>
      <div className="evidence-label">Output files</div>
      {artifacts.map((a) => (
        <div className="artifact-row" key={a.key}>
          <button
            className="text-button"
            disabled={busy}
            aria-busy={busy && selected === a.key}
            onClick={() => preview(a.key)}
          >
            {a.key.split("/").pop()}
          </button>
          <a
            href={`/api/v1/runs/${runId}/artifact?key=${encodeURIComponent(a.key)}`}
            aria-label={`Download ${a.key.split("/").pop()}`}
          >
            ↓
          </a>
        </div>
      ))}
      {busy && (
        <p className="processing-label" role="status">
          <Spinner /> Loading preview…
        </p>
      )}
      {error && (
        <p className="hint" role="status">
          {error}
        </p>
      )}
      {rows ? (
        <div className="evidence-scroll">
          <table className="matrix">
            <tbody>
              {rows.slice(0, 100).map((r, i) => (
                <tr key={i}>
                  {r.map((v, j) =>
                    i === 0 ? <th key={j}>{v}</th> : <td key={j}>{v}</td>,
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 100 && (
            <p className="hint">
              Showing the first 100 rows. Download the complete file.
            </p>
          )}
        </div>
      ) : (
        content !== null && <pre className="file-view">{content}</pre>
      )}
    </div>
  );
}
export function ObservationComparison({
  item,
}: {
  item: {
    file: string;
    selector: string;
    expected: unknown;
    actual: unknown;
    protected?: boolean;
    allowedPaths?: string[];
    format?: string;
  };
}) {
  const parse = (value: unknown) => {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  };
  function flatten(value: any, prefix = ""): Array<[string, unknown]> {
    if (value && typeof value === "object")
      return Object.entries(value).flatMap(([k, v]) =>
        flatten(
          v,
          `${prefix}/${k.replaceAll("~", "~0").replaceAll("/", "~1")}`,
        ),
      );
    return [[prefix || item.selector || "value", value]];
  }
  const before = new Map(flatten(parse(item.expected))),
    after = new Map(flatten(parse(item.actual)));
  const keys = [...new Set([...before.keys(), ...after.keys()])];
  return (
    <div className="observed-values">
      <small>
        {item.file}
        {item.selector}
      </small>
      <div className="evidence-scroll">
        <table className="matrix">
          <thead>
            <tr>
              <th>Field</th>
              <th>Expected</th>
              <th>Actual</th>
            </tr>
          </thead>
          <tbody>
            {keys.slice(0, 100).map((key) => (
              <tr
                key={key}
                className={
                  JSON.stringify(before.get(key)) !==
                  JSON.stringify(after.get(key))
                    ? "field-changed"
                    : ""
                }
              >
                <td>
                  {key}
                  {item.protected && !item.allowedPaths?.includes(key)
                    ? " · protected"
                    : ""}
                </td>
                <td>
                  {before.has(key)
                    ? JSON.stringify(before.get(key))
                    : "Missing"}
                </td>
                <td>
                  {after.has(key) ? JSON.stringify(after.get(key)) : "Missing"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {item.format === "xlsx" && (
        <p className="hint">
          Stored values and formula text. Formulas are not recalculated.
        </p>
      )}
    </div>
  );
}
