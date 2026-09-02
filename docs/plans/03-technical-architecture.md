# V1 Technical Architecture

## Components

```text
Browser
  ↕ HTTP + server-sent events
Web application
  ├── PostgreSQL
  ├── persistent artifact storage
  └── jobs table
          ↓
Single worker
  ├── Codex App Server + skill-upper for conversations
  └── Skill-Up + Codex CLI for eval runs
          ↓
Temporary directory per operation
```

There is one web application and one sequential worker. A separate model
gateway, microservice split, generic plugin system, and distributed queue are
not required.

## Codex login

The worker is logged in once to Codex and retains its credential store on an
encrypted persistent volume. Only the Codex process reads it. Agent-executed
commands run under a filesystem/process sandbox that cannot read or copy the
credential store. The v1 deployment is private and jobs run one at a time.

## Eval-authoring operation

1. Worker fetches the selected Skill version and task files.
2. Worker verifies checksums and creates a temporary directory.
3. Worker starts or resumes the eval-authoring App Server thread and explicitly
   supplies `skill-upper`.
4. Structured turn results update the eval draft and UI.
5. After plan approval, Codex writes eval files only in the temporary draft.
6. Worker scans generated scripts/paths and runs `skill-up validate`.
7. User approval stores one immutable eval-version artifact.

The database stores the Codex thread ID, messages, current structured summary,
and bound artifact IDs. If a thread cannot resume, the worker starts a new one
from that stored summary.

## Evaluation operation

1. Worker fetches the exact Skill and approved eval versions.
2. Worker verifies checksums and creates a clean temporary directory.
3. Worker installs the Skill only in that directory's `.codex/skills`.
4. Worker invokes pinned Skill-Up with the Codex engine.
5. Skill-Up creates isolated executions for cases and judges.
6. Worker stores raw reports and normalizes case results.
7. Worker deletes the temporary directory.

The tested agent receives only the case input and installed Skill. The semantic
judge receives only the grading rubric, allowed evidence, and tested output.

## Improvement operation

1. Worker creates a clean copy of the base Skill and visible failure evidence.
2. A separate `skill-upper` thread proposes a patch and optional eval changes.
3. User decision is recorded before any authoritative artifact changes.
4. Approval applies the patch to the copy and creates an immutable candidate.
5. Worker runs current and candidate versions against the same approved eval.
6. User explicitly chooses which version is current.

## Storage

PostgreSQL stores the seven domain records and small JSON summaries. Persistent
artifact storage holds ZIPs, task files, eval-version bundles, patches, Skill-Up
reports, transcripts, and produced files. Local development may use a directory;
the cloud deployment uses its platform's persistent object/file storage.

## Minimum security controls

- bounded upload and extraction;
- one writable temporary root per operation;
- non-root worker execution;
- CPU, memory, process, output, and timeout limits;
- no Docker socket, host paths, or sibling operation directories;
- no arbitrary setup commands or external network destinations;
- secrets excluded from prompts, reports, logs, and downloads;
- cleanup after success, failure, timeout, or cancellation.

## Failure handling

The jobs table records state, last progress, and error. On worker restart, one
running job is marked interrupted and may be retried from the last safe stage.
Validation and test failures are results, not infrastructure retries. Raw
Skill-Up reports remain authoritative if database result parsing fails.
