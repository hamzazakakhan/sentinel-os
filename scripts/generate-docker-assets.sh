#!/usr/bin/env bash
# Generate placeholder configs, certs, secrets for docker-compose
# Called by build-iso.sh with docker dir as $1
set -euo pipefail
D="${1:?Usage: $0 <docker-dir>}"

# ── Secrets ──
mkdir -p "$D/secrets"
for s in pg_password pg_replication_password neo4j_password webhook_hmac_secret twitter_token news_api_key misp_api_key elastic_password grafana_password oauth2_secret audit_encryption_key; do
  echo "CHANGE_ME" > "$D/secrets/${s}.txt"
done
for f in jwt_private_key.pem jwt_public_key.pem saml_cert.pem; do
  echo "REPLACE_WITH_REAL_KEY" > "$D/secrets/$f"
done

# ── Configs ──
mkdir -p "$D/configs/mosquitto"
cat > "$D/configs/mosquitto/mosquitto.conf" << 'EOF'
listener 1883
allow_anonymous true
listener 8883
cafile /mosquitto/certs/ca.crt
certfile /mosquitto/certs/mqtt.crt
keyfile /mosquitto/certs/mqtt.key
EOF

mkdir -p "$D/configs/suricata/rules"
cat > "$D/configs/suricata/suricata.yaml" << 'EOF'
default-rule-path: /etc/suricata/rules
rule-files: [suricata.rules]
EOF
touch "$D/configs/suricata/rules/suricata.rules"

mkdir -p "$D/configs/otel"
cat > "$D/configs/otel/otel-collector-config.yaml" << 'EOF'
receivers:
  otlp:
    protocols:
      grpc: {endpoint: "0.0.0.0:4317"}
      http: {endpoint: "0.0.0.0:4318"}
exporters:
  prometheus: {endpoint: "0.0.0.0:8889"}
  elasticsearch:
    endpoints: ["https://elasticsearch:9200"]
    tls: {insecure_skip_verify: true}
service:
  pipelines:
    metrics: {receivers: [otlp], exporters: [prometheus]}
    traces: {receivers: [otlp], exporters: [elasticsearch]}
EOF

mkdir -p "$D/configs/prometheus/rules"
cat > "$D/configs/prometheus/prometheus.yml" << 'EOF'
global: {scrape_interval: 15s}
scrape_configs:
  - job_name: otel-collector
    static_configs: [{targets: ['otel-collector:8889']}]
EOF
touch "$D/configs/prometheus/rules/sentinel-alerts.yml"

mkdir -p "$D/configs/grafana/provisioning/datasources"
cat > "$D/configs/grafana/provisioning/datasources/datasource.yml" << 'EOF'
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    url: http://prometheus:9090
    isDefault: true
EOF

# ── Certs (self-signed) ──
C="$D/certs"
mkdir -p "$C"/{pg,mongo,neo4j,redis,mqtt,elasticsearch,kibana,grafana}
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$C/ca.key" -out "$C/ca.crt" -days 3650 -subj "/CN=Sentinel-CA/O=Sentinel OS" 2>/dev/null
for svc in pg mongo neo4j redis mqtt elasticsearch kibana grafana; do
  openssl req -newkey rsa:2048 -nodes -keyout "$C/$svc/server.key" -out "$C/$svc/server.csr" -subj "/CN=$svc.sentinel-os.local/O=Sentinel OS" 2>/dev/null
  openssl x509 -req -in "$C/$svc/server.csr" -CA "$C/ca.crt" -CAkey "$C/ca.key" -CAcreateserial -out "$C/$svc/server.crt" -days 3650 2>/dev/null
  cp "$C/ca.crt" "$C/$svc/ca.crt"
  rm -f "$C/$svc/server.csr"
done
# MQTT needs specific names
cp "$C/mqtt/server.crt" "$C/mqtt/mqtt.crt" 2>/dev/null || true
cp "$C/mqtt/server.key" "$C/mqtt/mqtt.key" 2>/dev/null || true
# Elasticsearch/Kibana/Grafana need specific names
for svc in elasticsearch kibana grafana; do
  cp "$C/$svc/server.crt" "$C/$svc/${svc}.crt" 2>/dev/null || true
  cp "$C/$svc/server.key" "$C/$svc/${svc}.key" 2>/dev/null || true
done
# Redis needs specific names
cp "$C/redis/server.crt" "$C/redis/redis.crt" 2>/dev/null || true
cp "$C/redis/server.key" "$C/redis/redis.key" 2>/dev/null || true

echo "[generate-docker-assets] Done: configs, certs, secrets created"
