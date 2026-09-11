"use client";

import { useState } from "react";
import { useEvidenceNavigation } from "./evidence-navigation";
import { Spinner } from "./processing";
import type { AreaEvidence } from "@skilled/core";

export type EvidenceSeries = {
  trial: number;
  skill: AreaEvidence[];
  baseline?: AreaEvidence[];
};
type Scope = { area: string; view: string; trial: number };
const outcomes = [
  ["pass", "Passed", "#6bd5a3"],
  ["fail", "Failed", "#f18b91"],
  ["error", "Errors", "#b7a6ef"],
  ["missing", "Missing", "#536177"],
] as const;
const count = (a: AreaEvidence) =>
  a.expected ? `${a.pass}/${a.expected} passed` : "Not evaluated";

function OutcomeBar({ area }: { area: AreaEvidence }) {
  return (
    <div className="bar-track" aria-hidden="true">
      {outcomes.map(([key, , color]) => (
        <span
          key={key}
          style={{
            background: color,
            width: `${area.expected ? (100 * area[key]) / area.expected : 0}%`,
          }}
        />
      ))}
    </div>
  );
}

export function EvidenceChart({ series }: { series: EvidenceSeries[] }) {
  const { scope, pending, navigate } = useEvidenceNavigation();
  const [hovered, setHovered] = useState<string | null>(null);
  const current = series.find((s) => s.trial === scope.trial) ?? series[0]!;
  const compare = scope.view === "compare" && !!current.baseline;
  const areas =
    scope.view === "baseline"
      ? (current.baseline ?? current.skill)
      : current.skill;
  const plotted = compare
    ? [
        {
          id: "skill",
          label: "With Skill",
          areas: current.skill,
          color: "#84adff",
        },
        {
          id: "baseline",
          label: "Without Skill",
          areas: current.baseline!,
          color: "#ecb66b",
        },
      ]
    : [
        {
          id: scope.view,
          label: scope.view === "baseline" ? "Without Skill" : "With Skill",
          areas,
          color: scope.view === "baseline" ? "#ecb66b" : "#84adff",
        },
      ];
  const focusArea =
    areas.find((a) => a.id === (hovered ?? scope.area)) ?? areas[0];
  const trialLabel = scope.trial
    ? `Trial ${scope.trial}`
    : `All ${series.length - 1} trials`;
  const sameRates =
    compare &&
    areas.every((a, i) => {
      const b = current.baseline![i]!;
      return (
        a.expected > 0 &&
        b.expected > 0 &&
        a.pass * b.expected === b.pass * a.expected
      );
    });
  const complete = plotted.every((s) =>
    s.areas.every((a) => a.expected > 0 && a.missing === 0 && a.error === 0),
  );
  const update = (patch: Partial<Scope>, reset = false) => {
    setHovered(null);
    navigate(patch, reset);
  };
  const chooseArea = (id: string) =>
    update({ area: scope.area === id ? "" : id });
  const polar = (i: number, radius: number) => {
    const angle = (i * Math.PI * 2) / areas.length - Math.PI / 2;
    return [220 + Math.cos(angle) * radius, 195 + Math.sin(angle) * radius];
  };
  const points = (radius: number) =>
    areas.map((_, i) => polar(i, radius).join(",")).join(" ");
  const radar =
    areas.length >= 3 &&
    areas.length <= 8 &&
    plotted.every((s) => s.areas.every((a) => a.expected > 0));

  const areaDetail = (
    <div className="chart-area-detail" data-testid="chart-area-detail">
      <div>
        <small>
          {scope.area === focusArea?.id ? "SELECTED AREA" : "AREA PREVIEW"}
        </small>
        <h3>{focusArea?.label ?? "Every area, one evidence trail"}</h3>
        <p title={focusArea?.description}>
          {focusArea?.description ??
            "Select an area to see its checks and cases below. Hover or focus to preview it without changing the filter."}
        </p>
      </div>
      {focusArea ? (
        <div className="chart-detail-counts">
          {plotted.map((s) => {
            const a = s.areas.find((v) => v.id === focusArea.id)!;
            return (
              <div key={s.id}>
                <b>
                  {s.label} · {count(a)}
                </b>
                <span>
                  {a.fail} failed · {a.error} errors · {a.missing} missing
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
      <button
        className="chart-reset"
        onClick={() =>
          scope.area
            ? update({ area: "" })
            : focusArea && chooseArea(focusArea.id)
        }
      >
        {scope.area ? "Clear area filter" : "Filter these cases"}
      </button>
    </div>
  );

  return (
    <section className="chart-panel" aria-label="Judging area evidence">
      <div className="panel-heading">
        <div>
          <h2>Explore the evidence</h2>
          <p className="chart-caption">
            Choose a comparison, trial, or judging area.
          </p>
        </div>
        <button
          className="chart-reset"
          onClick={() => update({ area: "", view: "skill", trial: 0 }, true)}
        >
          Reset view
        </button>
      </div>
      <div className="chart-controls">
        <div
          className="chart-segments"
          role="group"
          aria-label="Evidence comparison"
        >
          {[
            ["skill", "With Skill"],
            ...(current.baseline
              ? [
                  ["baseline", "Without Skill"],
                  ["compare", "Compare both"],
                ]
              : []),
          ].map(([id, label]) => (
            <button
              key={id}
              aria-pressed={scope.view === id}
              onClick={() => update({ view: id })}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="chart-trial">
          Trial
          <select
            aria-label="Chart trial"
            value={scope.trial}
            onChange={(e) => update({ trial: Number(e.target.value) })}
          >
            {series.map((s) => (
              <option key={s.trial} value={s.trial}>
                {s.trial
                  ? `Trial ${s.trial}`
                  : `All ${series.length - 1} trials`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="chart-series-legend">
        {plotted.map((s) => (
          <span key={s.id}>
            <i
              style={{
                borderColor: s.color,
                borderStyle: s.id === "baseline" ? "dashed" : "solid",
              }}
            />
            {s.label}
          </span>
        ))}
        <span>{trialLabel} · required assertions</span>
      </div>
      <div className="chart-layout">
        <div className="radar-wrap">
          {radar && (
            <>
              <svg
                className="radar"
                viewBox="0 0 440 400"
                role="group"
                aria-label="Interactive judging area chart"
              >
                <title>Passed assertions as a share of expected evidence</title>
                {[0.25, 0.5, 0.75, 1].map((n) => (
                  <g key={n} aria-hidden="true">
                    <polygon
                      points={points(118 * n)}
                      fill="none"
                      stroke="#293241"
                    />
                    <text
                      className="radar-scale"
                      x="225"
                      y={195 - 118 * n + 12}
                    >
                      {n * 100}%
                    </text>
                  </g>
                ))}
                {plotted.map((s) => (
                  <polygon
                    key={s.id}
                    data-series={s.id}
                    points={s.areas
                      .map((a, i) =>
                        polar(i, (118 * a.pass) / a.expected).join(","),
                      )
                      .join(" ")}
                    fill={s.id === "baseline" ? "none" : `${s.color}18`}
                    stroke={s.color}
                    strokeWidth={s.id === "baseline" ? 3 : 2}
                    strokeDasharray={s.id === "baseline" ? "6 5" : undefined}
                    pointerEvents="none"
                    aria-hidden="true"
                  />
                ))}
                {areas.map((a, i) => {
                  const [x, y] = polar(i, 118);
                  const [lx, ly] = polar(i, 159);
                  const active = (hovered ?? scope.area) === a.id;
                  return (
                    <g
                      key={a.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${a.label}, ${plotted.map((s) => `${s.label}: ${count(s.areas[i]!)}`).join("; ")}. Filter cases.`}
                      aria-pressed={scope.area === a.id}
                      aria-controls="case-evidence"
                      className={`radar-axis ${active ? "is-active" : ""}`}
                      onClick={() => chooseArea(a.id)}
                      onPointerEnter={(e) => {
                        if (e.pointerType !== "touch") setHovered(a.id);
                      }}
                      onPointerLeave={() => setHovered(null)}
                      onFocus={() => setHovered(a.id)}
                      onBlur={() => setHovered(null)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          chooseArea(a.id);
                        }
                        if (
                          [
                            "ArrowRight",
                            "ArrowDown",
                            "ArrowLeft",
                            "ArrowUp",
                            "Home",
                            "End",
                          ].includes(e.key)
                        ) {
                          e.preventDefault();
                          const buttons =
                            e.currentTarget.parentElement?.querySelectorAll<SVGGElement>(
                              ".radar-axis",
                            );
                          const index =
                            e.key === "Home"
                              ? 0
                              : e.key === "End"
                                ? areas.length - 1
                                : (i +
                                    (["ArrowLeft", "ArrowUp"].includes(e.key)
                                      ? -1
                                      : 1) +
                                    areas.length) %
                                  areas.length;
                          buttons?.[index]?.focus();
                        }
                      }}
                    >
                      <line
                        x1="220"
                        y1="195"
                        x2={x}
                        y2={y}
                        stroke={active ? "#84adff" : "#293241"}
                      />
                      <line
                        x1="220"
                        y1="195"
                        x2={x}
                        y2={y}
                        stroke="transparent"
                        strokeWidth="18"
                      />
                      <circle cx={lx} cy={ly} r="28" className="axis-hit" />
                      <text x={lx} y={ly} textAnchor="middle">
                        {a.label.split(" ").map((word, n, all) => (
                          <tspan
                            key={n}
                            x={lx}
                            dy={n ? 13 : -(all.length - 1) * 5}
                          >
                            {word}
                          </tspan>
                        ))}
                      </text>
                      {plotted.map((s) => {
                        const [px, py] = polar(
                          i,
                          (118 * s.areas[i]!.pass) / s.areas[i]!.expected,
                        );
                        return (
                          <circle
                            key={s.id}
                            cx={px}
                            cy={py}
                            r={active ? 6 : 3.5}
                            fill={s.id === "baseline" ? "#12161e" : s.color}
                            stroke={s.color}
                            strokeWidth="2"
                          />
                        );
                      })}
                    </g>
                  );
                })}
              </svg>
              <p className="chart-caption">
                Rings: share of expected assertions passed.
                <br />
                Select an axis or a bar to filter the evidence.
              </p>
            </>
          )}
          {areaDetail}
        </div>
        <div className={`area-bars ${compare ? "is-comparison" : ""}`}>
          {areas.map((a, i) => (
            <button
              className={`area-bar ${(hovered ?? scope.area) === a.id ? "is-active" : ""}`}
              key={a.id}
              data-area={a.id}
              aria-label={`${a.label}. ${plotted
                .map((s) => {
                  const v = s.areas[i]!;
                  return `${s.label}: ${count(v)}, ${v.fail} failed, ${v.error} errors, ${v.missing} missing`;
                })
                .join(". ")}. Filter cases.`}
              aria-pressed={scope.area === a.id}
              aria-controls="case-evidence"
              onClick={() => chooseArea(a.id)}
              onPointerEnter={(e) => {
                if (e.pointerType !== "touch") setHovered(a.id);
              }}
              onPointerLeave={() => setHovered(null)}
              onFocus={() => setHovered(a.id)}
              onBlur={() => setHovered(null)}
            >
              <div className="area-bar-head">
                <span>{a.label}</span>
                <span>{scope.area === a.id ? "Selected" : "Inspect →"}</span>
              </div>
              {plotted.map((s) => {
                const value = s.areas[i]!;
                return (
                  <div className="area-series" data-series={s.id} key={s.id}>
                    <div className="area-series-head">
                      <span>{s.label}</span>
                      <span>{count(value)}</span>
                    </div>
                    <OutcomeBar area={value} />
                    <div className="chart-caption">
                      {value.fail} failed · {value.error} errors ·{" "}
                      {value.missing} missing
                    </div>
                  </div>
                );
              })}
            </button>
          ))}
        </div>
      </div>
      {sameRates && (
        <p className="chart-overlap">
          The pass rates overlap.{" "}
          {complete
            ? "No pass-rate difference was observed between these configurations."
            : "Incomplete or invalid evidence prevents a reliable benefit conclusion."}{" "}
          Both series remain available in the counts.
        </p>
      )}
      <div className="chart-legend">
        {outcomes.map(([key, label, color]) => (
          <span key={key}>
            <i style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
      <div className="chart-footer">
        <p className="chart-caption">
          Missing evidence stays in every denominator.{" "}
          {radar ? "" : "All areas are available in the bars."}
        </p>
        <p
          className={`chart-caption ${pending ? "processing-label" : ""}`}
          role="status"
        >
          {pending ? (
            <>
              <Spinner /> Updating linked cases…
            </>
          ) : (
            `${scope.area ? (areas.find((a) => a.id === scope.area)?.label ?? "All areas") : "All areas"} · ${trialLabel} · ${scope.view === "compare" ? "Both configurations" : plotted[0]!.label}`
          )}
        </p>
      </div>
    </section>
  );
}
