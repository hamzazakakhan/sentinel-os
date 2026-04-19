// ══════════════════════════════════════════════════════════════
// SENTINEL OS — Neo4j Graph Schema
// Intelligence Fusion Knowledge Graph
// ══════════════════════════════════════════════════════════════

// ── Node Constraints & Indexes ──

CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE;
CREATE CONSTRAINT entity_type_name IF NOT EXISTS FOR (e:Entity) REQUIRE (e.entity_type, e.name) IS NODE KEY;

CREATE CONSTRAINT person_id IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE;
CREATE CONSTRAINT organization_node_id IF NOT EXISTS FOR (o:Organization) REQUIRE o.id IS UNIQUE;
CREATE CONSTRAINT location_id IF NOT EXISTS FOR (l:Location) REQUIRE l.id IS UNIQUE;
CREATE CONSTRAINT vehicle_id IF NOT EXISTS FOR (v:Vehicle) REQUIRE v.id IS UNIQUE;
CREATE CONSTRAINT device_id IF NOT EXISTS FOR (d:Device) REQUIRE d.id IS UNIQUE;
CREATE CONSTRAINT weapon_id IF NOT EXISTS FOR (w:Weapon) REQUIRE w.id IS UNIQUE;
CREATE CONSTRAINT event_node_id IF NOT EXISTS FOR (e:Event) REQUIRE e.id IS UNIQUE;
CREATE CONSTRAINT threat_id IF NOT EXISTS FOR (t:Threat) REQUIRE t.id IS UNIQUE;
CREATE CONSTRAINT indicator_id IF NOT EXISTS FOR (i:Indicator) REQUIRE i.id IS UNIQUE;
CREATE CONSTRAINT campaign_id IF NOT EXISTS FOR (c:Campaign) REQUIRE c.id IS UNIQUE;
CREATE CONSTRAINT infrastructure_id IF NOT EXISTS FOR (i:Infrastructure) REQUIRE i.id IS UNIQUE;
CREATE CONSTRAINT document_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE;
CREATE CONSTRAINT sensor_node_id IF NOT EXISTS FOR (s:Sensor) REQUIRE s.id IS UNIQUE;
CREATE CONSTRAINT alert_node_id IF NOT EXISTS FOR (a:Alert) REQUIRE a.id IS UNIQUE;
CREATE CONSTRAINT cyber_event_id IF NOT EXISTS FOR (c:CyberEvent) REQUIRE c.id IS UNIQUE;
CREATE CONSTRAINT osint_item_id IF NOT EXISTS FOR (o:OsintItem) REQUIRE o.id IS UNIQUE;
CREATE CONSTRAINT mission_node_id IF NOT EXISTS FOR (m:Mission) REQUIRE m.id IS UNIQUE;
CREATE CONSTRAINT detection_node_id IF NOT EXISTS FOR (d:Detection) REQUIRE d.id IS UNIQUE;
CREATE CONSTRAINT track_node_id IF NOT EXISTS FOR (t:Track) REQUIRE t.id IS UNIQUE;
CREATE CONSTRAINT ip_address_id IF NOT EXISTS FOR (i:IPAddress) REQUIRE i.value IS UNIQUE;
CREATE CONSTRAINT domain_name_id IF NOT EXISTS FOR (d:DomainName) REQUIRE d.value IS UNIQUE;
CREATE CONSTRAINT hash_id IF NOT EXISTS FOR (h:Hash) REQUIRE h.value IS UNIQUE;
CREATE CONSTRAINT email_address_id IF NOT EXISTS FOR (e:EmailAddress) REQUIRE e.value IS UNIQUE;
CREATE CONSTRAINT phone_number_id IF NOT EXISTS FOR (p:PhoneNumber) REQUIRE p.value IS UNIQUE;
CREATE CONSTRAINT social_account_id IF NOT EXISTS FOR (s:SocialAccount) REQUIRE s.id IS UNIQUE;
CREATE CONSTRAINT adversary_id IF NOT EXISTS FOR (a:Adversary) REQUIRE a.id IS UNIQUE;
CREATE CONSTRAINT mitre_technique_id IF NOT EXISTS FOR (m:MitreTechnique) REQUIRE m.technique_id IS UNIQUE;
CREATE CONSTRAINT geo_region_id IF NOT EXISTS FOR (g:GeoRegion) REQUIRE g.id IS UNIQUE;

// ── Full-text Indexes ──

CREATE FULLTEXT INDEX entity_fulltext IF NOT EXISTS FOR (e:Entity) ON EACH [e.name, e.description, e.aliases];
CREATE FULLTEXT INDEX person_fulltext IF NOT EXISTS FOR (p:Person) ON EACH [p.name, p.aliases, p.nationality];
CREATE FULLTEXT INDEX event_fulltext IF NOT EXISTS FOR (e:Event) ON EACH [e.name, e.description];
CREATE FULLTEXT INDEX osint_fulltext IF NOT EXISTS FOR (o:OsintItem) ON EACH [o.title, o.content_summary];

// ── Point Indexes for Geospatial ──

CREATE POINT INDEX location_point IF NOT EXISTS FOR (l:Location) ON (l.coordinates);
CREATE POINT INDEX event_point IF NOT EXISTS FOR (e:Event) ON (e.coordinates);

// ── Range Indexes for Time-based Queries ──

CREATE INDEX entity_created IF NOT EXISTS FOR (e:Entity) ON (e.created_at);
CREATE INDEX event_timestamp IF NOT EXISTS FOR (e:Event) ON (e.occurred_at);
CREATE INDEX alert_created IF NOT EXISTS FOR (a:Alert) ON (a.created_at);
CREATE INDEX cyber_detected IF NOT EXISTS FOR (c:CyberEvent) ON (c.detected_at);
CREATE INDEX osint_collected IF NOT EXISTS FOR (o:OsintItem) ON (o.collected_at);
CREATE INDEX detection_timestamp IF NOT EXISTS FOR (d:Detection) ON (d.detected_at);

// ── Composite Indexes ──

CREATE INDEX entity_type_domain IF NOT EXISTS FOR (e:Entity) ON (e.entity_type, e.domain);
CREATE INDEX threat_severity_status IF NOT EXISTS FOR (t:Threat) ON (t.severity, t.status);
CREATE INDEX indicator_type_active IF NOT EXISTS FOR (i:Indicator) ON (i.indicator_type, i.is_active);

// ══════════════════════════════════════════════════════════════
// RELATIONSHIP TYPE DEFINITIONS (Documentation)
// ══════════════════════════════════════════════════════════════
//
// ── Entity Relationships ──
// (Person)-[:AFFILIATED_WITH {role, since, until, confidence}]->(Organization)
// (Person)-[:KNOWN_ASSOCIATE {relationship_type, confidence, first_seen, last_seen}]->(Person)
// (Person)-[:LOCATED_AT {timestamp, confidence}]->(Location)
// (Person)-[:OPERATES {role, confidence}]->(Vehicle)
// (Person)-[:USES {purpose, confidence}]->(Device)
// (Person)-[:CONTROLS {confidence}]->(SocialAccount)
// (Person)-[:COMMUNICATES_WITH {method, frequency, last_contact}]->(Person)
// (Person)-[:CONTACTED_VIA {timestamp}]->(PhoneNumber|EmailAddress)
//
// ── Threat / Campaign ──
// (Adversary)-[:CONDUCTS {timeframe}]->(Campaign)
// (Campaign)-[:TARGETS {motivation}]->(Entity|Organization|Location|Infrastructure)
// (Campaign)-[:USES_TECHNIQUE {confidence}]->(MitreTechnique)
// (Adversary)-[:USES_INFRASTRUCTURE {purpose}]->(Infrastructure)
// (Infrastructure)-[:RESOLVES_TO]->(IPAddress|DomainName)
// (Threat)-[:ATTRIBUTED_TO {confidence}]->(Adversary|Campaign)
// (Threat)-[:INDICATED_BY {confidence}]->(Indicator)
//
// ── Intelligence Fusion ──
// (Alert)-[:CORRELATED_WITH {score, method}]->(Alert)
// (Alert)-[:TRIGGERED_BY]->(Detection|CyberEvent|OsintItem)
// (Detection)-[:DETECTED_BY]->(Sensor)
// (Detection)-[:IDENTIFIED {confidence}]->(Entity|Track)
// (Track)-[:TRACKED_BY]->(Sensor)
// (OsintItem)-[:MENTIONS {context}]->(Entity|Location|Event)
// (OsintItem)-[:SOURCED_FROM]->(SocialAccount|DomainName)
// (CyberEvent)-[:ORIGINATES_FROM]->(IPAddress)
// (CyberEvent)-[:TARGETS_HOST]->(IPAddress)
// (CyberEvent)-[:MATCHES_INDICATOR]->(Indicator)
// (CyberEvent)-[:USES_TECHNIQUE]->(MitreTechnique)
//
// ── Geospatial ──
// (Entity)-[:OBSERVED_AT {timestamp, confidence}]->(Location)
// (Event)-[:OCCURRED_AT]->(Location)
// (Location)-[:WITHIN]->(GeoRegion)
// (Sensor)-[:DEPLOYED_AT]->(Location)
//
// ── Mission ──
// (Mission)-[:ASSIGNED_TO]->(Person|Organization)
// (Mission)-[:COVERS_AREA]->(GeoRegion)
// (Alert)-[:RELEVANT_TO]->(Mission)
// (Detection)-[:RELEVANT_TO]->(Mission)
//
// ── Cross-Domain Links ──
// (Entity)-[:SAME_AS {confidence, resolution_method}]->(Entity)
// (Entity)-[:RELATED_TO {relationship, confidence, source}]->(Entity)
// (Document)-[:REFERENCES]->(Entity|Event|Location)
// (Document)-[:PRODUCED_BY]->(Person|Organization)
