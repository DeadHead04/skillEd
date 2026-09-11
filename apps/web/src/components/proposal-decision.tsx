"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../lib/client-request";

/**
 * Skill changes and eval changes are decided independently: rejecting an eval
 * weakening must not throw away an otherwise good Skill patch. One primary
 * action commits whichever groups are selected.
 */
export function ProposalDecision({
  proposalId,
  expectedRevision,
  skillChangeCount,
  evalChangeCount,
}: {
  proposalId: string;
  expectedRevision: number;
  skillChangeCount: number;
  evalChangeCount: number;
}) {
  const [skillApproved, setSkillApproved] = useState(true);
  const [evalApproved, setEvalApproved] = useState(false);
  const [busy, setBusy] = useState<"" | "approve" | "reject">("");
  const [error, setError] = useState("");
  const router = useRouter();

  async function decide(approve: boolean) {
    setBusy(approve ? "approve" : "reject");
    setError("");
    const response = await apiFetch(`/api/v1/updates/${proposalId}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        skillDecision: approve && skillApproved ? "approved" : "rejected",
        evalDecision: approve && evalApproved ? "approved" : "rejected",
        expectedRevision,
      }),
    });
    const data = await response.json();
    setBusy("");
    if (!response.ok) {
      setError(data.detail ?? "The decision could not be recorded.");
      return;
    }
    router.refresh();
  }

  return (
    <>
      <div className="checkbox">
        <input
          id="skill-changes"
          type="checkbox"
          checked={skillApproved}
          onChange={(event) => setSkillApproved(event.target.checked)}
        />
        <label htmlFor="skill-changes">
          Skill changes
          <small>
            {skillChangeCount} file{skillChangeCount === 1 ? "" : "s"} rewritten
            in a new candidate version. The active Skill is untouched.
          </small>
        </label>
      </div>
      {evalChangeCount > 0 && (
        <div className="checkbox">
          <input
            id="eval-changes"
            type="checkbox"
            checked={evalApproved}
            onChange={(event) => setEvalApproved(event.target.checked)}
          />
          <label htmlFor="eval-changes">
            Eval changes
            <small>
              {evalChangeCount} case{evalChangeCount === 1 ? "" : "s"} altered.
              Accept only if this strengthens the evidence.
            </small>
          </label>
        </div>
      )}

      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}

      <div className="decision">
        <div>
          <b>
            {skillApproved || evalApproved
              ? "Approving creates a candidate, not an active Skill"
              : "Nothing selected"}
          </b>
          <p>
            {skillApproved || evalApproved
              ? "Verification then runs the current and candidate Skills against the identical frozen suite."
              : "Select at least one change group, or reject the proposal."}
          </p>
        </div>
        <div className="decision-actions">
          <button
            className="btn secondary"
            disabled={busy !== ""}
            aria-busy={busy === "reject"}
            onClick={() => decide(false)}
          >
            {busy === "reject" ? "Rejecting…" : "Reject"}
          </button>
          <button
            className="btn"
            disabled={busy !== "" || (!skillApproved && !evalApproved)}
            aria-busy={busy === "approve"}
            onClick={() => decide(true)}
          >
            {busy === "approve"
              ? "Working…"
              : skillApproved && evalApproved
                ? "Approve Skill and eval"
                : evalApproved
                  ? "Approve eval only"
                  : "Approve Skill only"}
          </button>
        </div>
      </div>
    </>
  );
}
