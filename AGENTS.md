# Repository guidance

`skilled` is a TypeScript/ESM evaluation CLI; the improvement workflow is `skilled-improve`. The pinned original implementation and migration records are outside this product checkout. Preserve behavior when porting; do not add legacy-name runtime aliases.

## Setup and checks

Use Node 24.21.0 (`.nvmrc`), `npm ci`, and `npm run build`. The executable entrypoint is `src/bootstrap.ts`; CLI glue is in `src/cli`, public execution in `src/api`, and domain logic in the corresponding `src/` module. Plugin and example TypeScript is compiled with the application.

Run `npm run typecheck` and meaningful tests for affected behavior. Build before running compiled tests. Run the cumulative phase gate for an integrated migration milestone; keep failed, skipped and unavailable checks visible. Avoid clean builds while another agent is using `dist/`; coordinate shared interfaces and dependency changes.

Acceptance uses actual production functions, files, processes, services and hosts. Do not substitute fake models, executables or runtimes for required real integration checks. Authenticated model calls need explicitly configured credentials and a spending limit. Missing accounts or devices must be recorded as unverified.

## Boundaries

- Keep serialized config/result fields compatible with the source schemas.
- Internal TypeScript APIs use camelCase, promises, milliseconds and `AbortSignal`.
- Keep shell quoting and process handling in the existing platform/runtime helpers.
- `skills/skilled-improve` is the canonical workflow; build plugin copies with `scripts/package-plugins.mjs`.
- Go files under the code-statistics example are sample input only; do not convert that fixture merely because its extension is `.go`.
- Preserve Apache-2.0 and original copyright notices.
- Do not write secrets into code, tests, logs, examples or artifacts.

## Documentation and release

Update English user documentation when changing setup or CLI behavior. Historical design/proposal documents describe the original design and may retain explanatory Go snippets; executable application code is TypeScript.

Only configured owner-controlled repositories, registries and documentation hosts may be used for publishing. Do not invent public endpoints or claim that builds certify untested platforms. Release tags and publication are separate from local packaging.
