# Use your Codex login in Docker

Docker evaluations can use an existing file-based ChatGPT login through an explicit opt-in. Native evaluations continue to use the login already available on the host.

```yaml
environment:
  type: docker
  image: node:22

engine:
  name: codex
  version: "0.162.1"
  kwargs:
    codex_auth_file: /absolute/path/to/your/isolated-codex-home/auth.json
```

Use a regular `auth.json` file from a successful `codex login` using ChatGPT. The path must be absolute; symlinks, API-key login files, and custom provider overrides are rejected. If your login is stored in an operating-system credential store, this option does not extract it. Use a separately configured file-based Codex login instead.

Prefer supplying the path locally rather than committing a personal path:

```sh
skilled run path/to/evals/eval.yaml \
  --engine-kwarg codex_auth_file=/absolute/path/to/auth.json
```

The adapter copies only that file into a fresh private directory inside each container and points `CODEX_HOME` there. It does not copy host configuration, previous conversations, global Skills, or the whole home directory. The source file is not changed. Container token refreshes are not copied back to the host. API-key environment variables are cleared for this opt-in execution, so it does not silently fall back to API billing.

The container must be trusted with this login: its agent and commands can access the copied credential. Do not bake credentials into an image, include them in a Skill, or request them as evaluation artifacts. Private login files are outside the workspace and are erased when skilled stops or closes the runtime, including when `--no-delete` retains the container. Grading containers receive fresh authentication only when their own Codex agent explicitly uses this option.

Use a clean image with the required tools. The ordinary agent installation step installs the pinned Codex version if necessary; a prebuilt image with that exact version avoids repeating installation. Network access and a valid ChatGPT subscription login are required. Validate real model access before a large benchmark.

This uses the [documented Codex auth-cache transfer method](https://learn.chatgpt.com/docs/auth#fallback-authenticate-locally-and-copy-your-auth-cache).
