import { profileHash } from "@skilled/core";
import { ReadMore } from "./studio";

export function ProfileRevision({
  current,
  proposed,
}: {
  current: { understanding: any; plan: any };
  proposed: { understanding: any; plan: any };
}) {
  const changes: Array<{ label: string; before: string; after: string }> = [];
  for (const key of [
    ...new Set([
      ...Object.keys(current.understanding ?? {}),
      ...Object.keys(proposed.understanding ?? {}),
    ]),
  ]) {
    const before = current.understanding?.[key] ?? [],
      after = proposed.understanding?.[key] ?? [];
    if (profileHash(before, null) !== profileHash(after, null))
      changes.push({
        label: key.replace(/([A-Z])/g, " $1"),
        before: before.join(" · ") || "None",
        after: after.join(" · ") || "None",
      });
  }
  for (const field of ["areas", "groups"]) {
    const before = new Map<string, any>(
      (current.plan?.[field] ?? []).map((a: any) => [a.id ?? a.name, a]),
    );
    const after = new Map<string, any>(
      (proposed.plan?.[field] ?? []).map((a: any) => [a.id ?? a.name, a]),
    );
    const describe = (a: any) =>
      !a
        ? "Not included"
        : field === "areas"
          ? `${a.label}: ${a.description}. ${a.required ? "Required" : "Optional"} · ${a.role.replaceAll("_", " ")}`
          : `${a.caseCount} cases · ${a.dimensions.join(", ")} · ${a.judge} judge`;
    for (const id of new Set([...before.keys(), ...after.keys()]))
      if (
        profileHash(before.get(id) ?? null, null) !==
        profileHash(after.get(id) ?? null, null)
      )
        changes.push({
          label: after.get(id)?.label ?? before.get(id)?.label ?? id,
          before: describe(before.get(id)),
          after: describe(after.get(id)),
        });
  }
  return (
    <div className="profile-revision">
      <p className="hint">
        {changes.length} reviewable changes. Applying creates a new draft
        revision and clears generated cases.
      </p>
      {changes.map((c, i) => (
        <div className="finding-card" key={i}>
          <strong>{c.label}</strong>
          <div className="revision-pair">
            <div>
              <small>Current</small>
              <ReadMore text={c.before} />
            </div>
            <div>
              <small>Proposed</small>
              <ReadMore text={c.after} />
            </div>
          </div>
        </div>
      ))}
      {!changes.length && <p>No changes to task understanding or coverage.</p>}
    </div>
  );
}
