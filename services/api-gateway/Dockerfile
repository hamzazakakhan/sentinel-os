FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM node:20-alpine AS runtime
RUN apk add --no-cache tini curl && \
    addgroup -g 1001 sentinel && \
    adduser -u 1001 -G sentinel -s /bin/sh -D sentinel
WORKDIR /app
COPY --from=builder /app/package*.json ./
RUN npm ci --production && npm cache clean --force
COPY --from=builder /app/dist/ dist/
COPY src/schema/ dist/schema/
USER sentinel
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:4000/health/live || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
