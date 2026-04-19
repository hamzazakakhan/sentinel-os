FROM nvidia/cuda:12.3.1-runtime-ubuntu22.04 AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    nodejs npm curl libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir \
    ultralytics==8.1.0 \
    scikit-learn==1.4.0 \
    torch==2.2.0 \
    numpy==1.26.3 \
    pandas==2.1.5 \
    onnxruntime-gpu==1.17.0 \
    opencv-python-headless==4.9.0.80 \
    joblib==1.3.2

FROM base AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM base AS runtime
RUN groupadd -g 1001 sentinel && \
    useradd -u 1001 -g sentinel -s /bin/bash -m sentinel
WORKDIR /app
COPY --from=builder /app/package*.json ./
RUN npm ci --production && npm cache clean --force
COPY --from=builder /app/dist/ dist/
COPY src/models/python/ dist/models/python/
USER sentinel
EXPOSE 4003
HEALTHCHECK --interval=15s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:4003/health || exit 1
CMD ["node", "dist/index.js"]
