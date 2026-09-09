FROM golang:1.25.5-bookworm@sha256:d9132cce84391efab786495288756d60e1da215b1f94e87860aeefc3d4c45b6d AS skillup
WORKDIR /src
COPY skill-up/go.mod skill-up/go.sum ./
RUN go mod download
COPY skill-up/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-X main.version=skilled-v2" -o /out/skill-up ./cmd/skill-up

FROM node:24.13.0-bookworm-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f AS deps
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/core/package.json packages/core/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --filter @skilled/worker... --frozen-lockfile

FROM node:24.13.0-bookworm-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates git && rm -rf /var/lib/apt/lists/* \
  && npm install -g @openai/codex@0.149.0-alpha.4.1 \
  && pip3 install --break-system-packages --no-cache-dir openpyxl==3.1.5 python-docx==1.2.0 pypdf==6.1.1
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/worker apps/worker
COPY --from=skillup /out/skill-up /usr/local/bin/skill-up
COPY skill-up/skills/skill-upper /opt/skilled/skill-upper
COPY apps/worker/src/script-sandbox.py /usr/local/bin/skilled-script-sandbox
COPY infra/render-canary/canary.mjs /opt/skilled/canary.mjs
# Invoke the native sandbox binary under judge limits; the npm Node launcher
# cannot initialize its virtual heap inside the 512 MiB address-space limit.
RUN find /usr/local/lib/node_modules/@openai/codex -type f -path '*/bin/codex' -exec ln -s '{}' /usr/local/bin/skilled-codex ';' \
  && test -x /usr/local/bin/skilled-codex
RUN groupadd -g 10001 skilled && useradd -u 10001 -g 10001 -m skilled \
  && mkdir -p /data/artifacts /data/work /data/executor /home/skilled/.codex \
  && chmod 755 /usr/local/bin/skilled-script-sandbox \
  && chown -R skilled:skilled /data /home/skilled
USER 10001:10001
ENV HOME=/home/skilled SKILLED_SCRIPT_SANDBOX=/usr/local/bin/skilled-script-sandbox CODEX_HOME=/home/skilled/.codex SKILL_UP_BIN=/usr/local/bin/skill-up
CMD ["node", "--import", "tsx", "apps/worker/src/index.ts"]
