// sentinel-os/databases/mongodb/schemas/validators.js
// MongoDB collection validators and indexes

db = db.getSiblingDB('sentinel');

// Sensor telemetry collection
db.createCollection("sensor_telemetry", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["sensor_id", "timestamp", "data_type"],
      properties: {
        sensor_id: { bsonType: "string" },
        timestamp: { bsonType: "date" },
        data_type: { enum: ["rtsp_frame", "mqtt_message", "radar_ping", "drone_telemetry", "sdr_signal", "gps_position"] },
        payload: { bsonType: "object" },
        location: {
          bsonType: "object",
          properties: {
            type: { enum: ["Point"] },
            coordinates: { bsonType: "array", items: { bsonType: "double" } }
          }
        },
        classification: { enum: ["UNCLASSIFIED", "CUI", "CONFIDENTIAL", "SECRET", "TOP_SECRET"] },
        processed: { bsonType: "bool" }
      }
    }
  }
});
db.sensor_telemetry.createIndex({ sensor_id: 1, timestamp: -1 });
db.sensor_telemetry.createIndex({ "location": "2dsphere" });
db.sensor_telemetry.createIndex({ data_type: 1 });
db.sensor_telemetry.createIndex({ timestamp: -1 }, { expireAfterSeconds: 2592000 }); // 30 day TTL

// Cyber events collection
db.createCollection("cyber_events", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["event_type", "timestamp", "source"],
      properties: {
        event_type: { bsonType: "string" },
        timestamp: { bsonType: "date" },
        source: { bsonType: "string" },
        severity: { enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
        src_ip: { bsonType: "string" },
        dst_ip: { bsonType: "string" },
        raw_event: { bsonType: "object" },
        iocs: { bsonType: "array", items: { bsonType: "object" } }
      }
    }
  }
});
db.cyber_events.createIndex({ event_type: 1, timestamp: -1 });
db.cyber_events.createIndex({ src_ip: 1 });
db.cyber_events.createIndex({ severity: 1 });
db.cyber_events.createIndex({ timestamp: -1 }, { expireAfterSeconds: 604800 }); // 7 day TTL

// OSINT items collection
db.createCollection("osint_items", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["source", "collected_at"],
      properties: {
        source: { bsonType: "string" },
        title: { bsonType: "string" },
        url: { bsonType: "string" },
        body: { bsonType: "string" },
        collected_at: { bsonType: "date" },
        sentiment: { bsonType: "string" },
        credibility_score: { bsonType: "double" },
        entities: { bsonType: "array", items: { bsonType: "object" } },
        tags: { bsonType: "array", items: { bsonType: "string" } }
      }
    }
  }
});
db.osint_items.createIndex({ source: 1, collected_at: -1 });
db.osint_items.createIndex({ "entities.value": 1 });
db.osint_items.createIndex({ tags: 1 });
db.osint_items.createIndex({ collected_at: -1 }, { expireAfterSeconds: 5184000 }); // 60 day TTL

// Simulation results collection
db.createCollection("simulation_results", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["scenario_id", "team", "started_at"],
      properties: {
        scenario_id: { bsonType: "string" },
        team: { enum: ["RED", "BLUE", "PURPLE"] },
        technique_id: { bsonType: "string" },
        started_at: { bsonType: "date" },
        completed_at: { bsonType: "date" },
        status: { enum: ["PLANNED", "EXECUTING", "DETECTED", "MISSED", "BLOCKED", "COMPLETED"] },
        detection_time_sec: { bsonType: "double" }
      }
    }
  }
});
db.simulation_results.createIndex({ scenario_id: 1 });
db.simulation_results.createIndex({ team: 1, status: 1 });
