# Build from the repository root: docker build -f action/Dockerfile .
FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /opt/skilled
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
ARG CLAUDE_VERSION=2.1.217
ARG CODEX_VERSION=0.80.0
ARG OPENCODE_VERSION=1.18.33
ARG QWEN_CODE_VERSION=0.20.1
ARG QODER_VERSION=1.1.41
ARG QODER_AMD64_SHA256=1c2d174b098eb472a9ac19a80b89a664fdcb7d37dca09e64f44243faa4e3eca7
ARG QODER_ARM64_SHA256=929a067fb282e8a049890980a760109f2bf008b1523d5f041df24515057308e1
ARG TARGETARCH
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="skilled action runner" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="0.2.0"
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-yaml curl bash git ca-certificates unzip && rm -rf /var/lib/apt/lists/*
RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_VERSION}" "@openai/codex@${CODEX_VERSION}" "opencode-ai@${OPENCODE_VERSION}" "@qwen-code/qwen-code@${QWEN_CODE_VERSION}" \
    && claude --version && codex --version && opencode --version && qwen --version
RUN case "${TARGETARCH}" in amd64) archive_arch=x64; expected="${QODER_AMD64_SHA256}";; arm64) archive_arch=arm64; expected="${QODER_ARM64_SHA256}";; *) echo 'Unsupported action architecture' >&2; exit 1;; esac \
    && temp="$(mktemp -d)" \
    && curl -fsSL --retry 3 "https://qoder-ide.oss-accelerate.aliyuncs.com/qodercli/releases/${QODER_VERSION}/qodercli-linux-${archive_arch}.tar.gz" -o "$temp/qodercli.tar.gz" \
    && echo "${expected}  $temp/qodercli.tar.gz" | sha256sum -c - \
    && tar -xzf "$temp/qodercli.tar.gz" -C "$temp" ./qodercli \
    && install -m 0755 "$temp/qodercli" /usr/local/bin/qodercli \
    && rm -rf "$temp" && qodercli --version
COPY --from=build /opt/skilled /opt/skilled
RUN printf '#!/bin/sh\nexec node /opt/skilled/dist/src/bootstrap.js "$@"\n' > /usr/local/bin/skilled \
    && chmod +x /usr/local/bin/skilled /opt/skilled/action/entry.sh \
    && skilled --version
WORKDIR /github/workspace
ENTRYPOINT ["/opt/skilled/action/entry.sh"]
