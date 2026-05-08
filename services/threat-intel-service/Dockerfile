FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM node:20-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 1001 sentinel && useradd -u 1001 -g sentinel -s /bin/bash -m sentinel
WORKDIR /app
COPY --from=builder /app/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=builder /app/dist/ dist/
USER sentinel
EXPOSE 8091
HEALTHCHECK --interval=15s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:8091/health || exit 1
CMD ["node", "dist/index.js"]
