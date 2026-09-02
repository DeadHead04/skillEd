FROM golang:1.25-bookworm AS skillup
WORKDIR /src
COPY skill-up/go.mod skill-up/go.sum ./
RUN go mod download
COPY skill-up/ ./
RUN CGO_ENABLED=0 go build -trimpath -o /out/skill-up ./cmd/skill-up

FROM node:24-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/core/package.json packages/core/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --filter @skilled/worker... --frozen-lockfile=false

FROM node:24-bookworm-slim
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
RUN mkdir -p /data/artifacts /data/work /home/skilled/.codex
ENV CODEX_HOME=/home/skilled/.codex SKILL_UP_BIN=/usr/local/bin/skill-up
CMD ["node", "--import", "tsx", "apps/worker/src/index.ts"]
