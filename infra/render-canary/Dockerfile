FROM node:24.13.0-bookworm-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates && rm -rf /var/lib/apt/lists/* \
    && npm install -g @openai/codex@0.149.0-alpha.4.1 \
    && useradd --uid 10001 --create-home skilled
WORKDIR /app
COPY canary.mjs ./canary.mjs
USER 10001:10001
ENV NODE_ENV=production PORT=10000
CMD ["node", "/app/canary.mjs"]
