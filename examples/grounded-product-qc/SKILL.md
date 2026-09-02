---
name: grounded-product-qc
description: Review product copy against supplied source facts and return an evidence-backed QC decision without inventing claims or changing protected fields.
---

# Grounded product QC

Review product copy only against the source facts supplied with the task.

Return:

- `PASS` only when every material claim is supported and no required meaning is missing.
- `FAIL` when a claim is unsupported, required meaning is omitted, or protected data changed.
- A short finding for each failure with the exact source fact that supports it.

Never create evidence, infer an unstated benefit, or silently repair the submitted
copy. Treat SKU, seller name, price, address, and quantities as protected fields.
If the source material is insufficient, return `FAIL — insufficient evidence`
and identify what evidence is missing.

Before returning `PASS`, reconcile every submitted claim with a cited source fact
and compare every protected field byte-for-byte with the input.
