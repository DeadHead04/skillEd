# Third-party software

## Alibaba Skill-Up

- Upstream: <https://github.com/alibaba/skill-up>
- Pinned commit: `6da1264f626661b4b649569469cb3e8212e723da`
- License: Apache License 2.0
- Local source: [`skill-up/`](skill-up/)
- Upstream license: [`skill-up/LICENSE`](skill-up/LICENSE)

The `skill-up/` directory is a clean copy of files tracked by the pinned
upstream commit. It intentionally excludes the upstream `.git` directory,
dependencies, caches, binaries, generated documentation, and local test
artifacts.

SkillEd-specific orchestration should normally live outside this directory.
If the upstream source is modified, the change must retain the Apache-2.0
license and notices, be documented as a local modification, and include tests
required by [`skill-up/AGENTS.md`](skill-up/AGENTS.md).

To update the internal copy, review upstream changes, select a new immutable
commit, replace the directory from `git archive`, run the upstream verification
suite, and update the pinned commit in this file and the root README in the same
commit.
