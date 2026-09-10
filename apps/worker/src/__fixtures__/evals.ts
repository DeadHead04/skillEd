import { CoveragePlanSchema, TaskUnderstandingSchema } from "@skilled/core";

export const DEFAULT_UNDERSTANDING = TaskUnderstandingSchema.parse({
  inputs: ["Uploaded task files and Skill instructions"],
  outputs: ["The requested output, with evidence that it meets the task rules"],
  authorities: ["Uploaded rules and expected outputs"],
  invariants: [
    "Do not fabricate evidence",
    "Do not approve semantic omissions",
    "Do not modify source data",
  ],
  allowedChanges: ["Only changes explicitly requested by the task"],
  dependencies: ["none"],
  ambiguity: ["Confirm which output fields may change"],
  likelyHallucinations: [
    "Invented source claims",
    "Evidence not present in input",
    "Facts or changes not supported by the task",
  ],
  failureModes: [
    "False PASS",
    "semantic omission",
    "scope drift",
    "hard-lock violation",
    "incoherent correction",
  ],
});

export const DEFAULT_PLAN = CoveragePlanSchema.parse({
  groups: [
    {
      name: "Core correctness",
      purpose: "Prove valid and invalid content are classified correctly",
      caseCount: 4,
      judge: "agent",
      dimensions: ["correctness", "semantic", "source"],
      provenance: ["task", "authority"],
      iterations: 1,
    },
    {
      name: "False green / adversarial",
      purpose:
        "Catch confident approval despite fabricated, omitted, or invented evidence",
      caseCount: 4,
      judge: "agent",
      dimensions: ["correctness", "semantic", "source", "scope"],
      provenance: ["recorded failure patterns"],
      iterations: 3,
    },
    {
      name: "Hard locks & artifacts",
      purpose:
        "Verify protected fields, structure, and unrelated content remain unchanged",
      caseCount: 2,
      judge: "script",
      dimensions: ["semantic", "scope", "artifact"],
      provenance: ["task invariants"],
      iterations: 1,
    },
  ],
});

export const cases = [
  [
    "CORE-001",
    "Valid output grounded in the input",
    "Core correctness",
    "agent",
    ["correctness", "semantic", "source"],
  ],
  [
    "CORE-002",
    "Incorrect interpretation of the input",
    "Core correctness",
    "agent",
    ["correctness", "semantic"],
  ],
  [
    "CORE-003",
    "Unsupported benefit claim",
    "Core correctness",
    "agent",
    ["correctness", "source"],
  ],
  [
    "CORE-004",
    "An equivalent valid output",
    "Core correctness",
    "agent",
    ["correctness", "semantic"],
  ],
  [
    "FG-001",
    "Fabricated evidence",
    "False green / adversarial",
    "agent",
    ["correctness", "source"],
  ],
  [
    "FG-002",
    "Semantic omission",
    "False green / adversarial",
    "agent",
    ["correctness", "semantic"],
  ],
  [
    "FG-003",
    "Invented claim",
    "False green / adversarial",
    "agent",
    ["correctness", "source"],
  ],
  [
    "FG-004",
    "An unauthorized field addition",
    "False green / adversarial",
    "agent",
    ["correctness", "scope"],
  ],
  [
    "CTRL-001",
    "Hard locks",
    "Hard locks & artifacts",
    "script",
    ["scope", "artifact"],
  ],
  [
    "CTRL-002",
    "Coherence",
    "Hard locks & artifacts",
    "script",
    ["semantic", "artifact"],
  ],
] as const;

export const productCases = [
  [
    "CORE-001",
    "Fully supported product card",
    "Core correctness",
    "agent",
    ["correctness", "semantic", "source"],
  ],
  [
    "CORE-002",
    "Material warning omitted",
    "Core correctness",
    "agent",
    ["correctness", "semantic"],
  ],
  [
    "CORE-003",
    "Unsupported benefit claim",
    "Core correctness",
    "agent",
    ["correctness", "source"],
  ],
  [
    "CORE-004",
    "Insufficient evidence rejected",
    "Core correctness",
    "agent",
    ["correctness", "source"],
  ],
  [
    "FG-001",
    "Fabricated source citation",
    "False green / adversarial",
    "agent",
    ["correctness", "source"],
  ],
  [
    "FG-002",
    "Omitted allergen warning",
    "False green / adversarial",
    "agent",
    ["correctness", "semantic"],
  ],
  [
    "FG-003",
    "Invented clinical claim",
    "False green / adversarial",
    "agent",
    ["correctness", "source"],
  ],
  [
    "FG-004",
    "Protected SKU changed",
    "False green / adversarial",
    "agent",
    ["correctness", "scope"],
  ],
  [
    "CTRL-001",
    "Protected field locks",
    "Hard locks & artifacts",
    "script",
    ["scope", "artifact"],
  ],
  [
    "CTRL-002",
    "Decision and citations agree",
    "Hard locks & artifacts",
    "script",
    ["semantic", "artifact"],
  ],
] as const;

export const PRODUCT_UNDERSTANDING = TaskUnderstandingSchema.parse({
  inputs: ["Product card", "authoritative source facts"],
  outputs: ["PASS or FAIL", "cited findings", "protected-field drift"],
  authorities: ["Uploaded source rules and recorded failures"],
  invariants: [
    "Never fabricate or infer evidence",
    "Do not approve material omissions",
    "Preserve SKU, seller, price, quantity, and address",
  ],
  allowedChanges: ["QC decision and evidence findings only"],
  dependencies: ["Skill instructions", "uploaded authority material"],
  ambiguity: ["Whether a missing fact is material to the decision"],
  likelyHallucinations: [
    "Invented citations",
    "Unsupported benefits",
    "Unstated clinical claims",
  ],
  failureModes: [
    "False PASS without traceable evidence",
    "material omission",
    "protected-field drift",
    "unsupported claim",
    "decision-evidence contradiction",
  ],
});
