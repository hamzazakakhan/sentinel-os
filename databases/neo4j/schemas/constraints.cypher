// sentinel-os/databases/neo4j/schemas/constraints.cypher
// Neo4j constraints, indexes, and relationship type definitions

// ── Unique constraints ──
CREATE CONSTRAINT threat_actor_id IF NOT EXISTS FOR (n:threat_actor) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT malware_id IF NOT EXISTS FOR (n:malware) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT ip_id IF NOT EXISTS FOR (n:ip) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT domain_id IF NOT EXISTS FOR (n:domain) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT hash_id IF NOT EXISTS FOR (n:hash) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT email_id IF NOT EXISTS FOR (n:email) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT location_id IF NOT EXISTS FOR (n:location) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT organization_id IF NOT EXISTS FOR (n:organization) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT vulnerability_id IF NOT EXISTS FOR (n:vulnerability) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT alert_id IF NOT EXISTS FOR (n:alert) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT sensor_id IF NOT EXISTS FOR (n:sensor) REQUIRE n.id IS UNIQUE;

// ── Value uniqueness ──
CREATE CONSTRAINT ip_value_unique IF NOT EXISTS FOR (n:ip) REQUIRE n.value IS UNIQUE;
CREATE CONSTRAINT domain_value_unique IF NOT EXISTS FOR (n:domain) REQUIRE n.value IS UNIQUE;
CREATE CONSTRAINT hash_value_unique IF NOT EXISTS FOR (n:hash) REQUIRE n.value IS UNIQUE;
CREATE CONSTRAINT cve_id_unique IF NOT EXISTS FOR (n:vulnerability) REQUIRE n.cve_id IS UNIQUE;

// ── Text indexes for search ──
CREATE TEXT INDEX threat_actor_name_idx IF NOT EXISTS FOR (n:threat_actor) ON (n.name);
CREATE TEXT INDEX malware_name_idx IF NOT EXISTS FOR (n:malware) ON (n.name);
CREATE TEXT INDEX alert_title_idx IF NOT EXISTS FOR (n:alert) ON (n.title);

// ── Range indexes ──
CREATE RANGE INDEX alert_risk_score_idx IF NOT EXISTS FOR (n:alert) ON (n.risk_score);
CREATE RANGE INDEX entity_last_seen_idx IF NOT EXISTS FOR (n:threat_actor) ON (n.last_seen);
CREATE RANGE INDEX entity_last_seen_malware IF NOT EXISTS FOR (n:malware) ON (n.last_seen);

// ── Relationship types (documented) ──
// :USES              - threat_actor -> malware
// :TARGETS           - threat_actor -> organization / location
// :COMMUNICATES_WITH - ip -> ip / domain
// :RESOLVES_TO       - domain -> ip
// :HOSTS             - ip -> malware
// :EXPLOITS          - malware -> vulnerability
// :DERIVED_FROM      - malware -> malware
// :LOCATED_IN        - ip -> location
// :TRIGGERED         - alert -> ip / domain / hash
// :CORRELATED_WITH   - alert -> alert
// :DETECTED_BY       - alert -> sensor
// :ATTRIBUTED_TO     - alert -> threat_actor
// :SHARES_INFRA      - ip -> ip
// :SEEN_WITH         - malware -> malware
