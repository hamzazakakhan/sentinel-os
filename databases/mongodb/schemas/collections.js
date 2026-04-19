// ══════════════════════════════════════════════════════════════
// SENTINEL OS — MongoDB Collection Schemas & Indexes
// Database: sentinel
// ══════════════════════════════════════════════════════════════

db = db.getSiblingDB('sentinel');

// ── Raw Sensor Data ──
db.createCollection('raw_sensor_data', {
    validator: {
        $jsonSchema: {
            bsonType: 'object',
            required: ['sensor_id', 'sensor_type', 'domain', 'data_type', 'payload', 'ingested_at'],
            properties: {
                sensor_id: { bsonType: 'string', description: 'UUID of the originating sensor' },
                sensor_type: { enum: ['CCTV', 'DRONE', 'RADAR', 'IOT', 'ACOUSTIC', 'SEISMIC', 'RF', 'LIDAR', 'THERMAL', 'SATELLITE'] },
                domain: { enum: ['LAND', 'AIR', 'SEA', 'CYBER', 'SPACE', 'INTELLIGENCE', 'OSINT'] },
                data_type: { enum: ['video_frame', 'telemetry', 'radar_sweep', 'iot_reading', 'acoustic_sample', 'rf_spectrum', 'lidar_pointcloud', 'thermal_image', 'satellite_imagery'] },
                payload: { bsonType: 'object' },
                location: {
                    bsonType: 'object',
                    properties: {
                        type: { enum: ['Point'] },
                        coordinates: { bsonType: 'array', minItems: 2, maxItems: 3 }
                    }
                },
                edge_node_id: { bsonType: 'string' },
                edge_processed: { bsonType: 'bool' },
                edge_detections: { bsonType: 'array' },
                classification: { enum: ['UNCLASSIFIED', 'CONFIDENTIAL', 'SECRET', 'TOP_SECRET', 'SCI'] },
                ttl_expiry: { bsonType: 'date' },
                checksum: { bsonType: 'string' },
                ingested_at: { bsonType: 'date' },
                processed_at: { bsonType: 'date' }
            }
        }
    },
    storageEngine: {
        wiredTiger: {
            configString: 'block_compressor=zstd'
        }
    }
});

db.raw_sensor_data.createIndex({ 'sensor_id': 1, 'ingested_at': -1 });
db.raw_sensor_data.createIndex({ 'sensor_type': 1, 'ingested_at': -1 });
db.raw_sensor_data.createIndex({ 'domain': 1, 'ingested_at': -1 });
db.raw_sensor_data.createIndex({ 'location': '2dsphere' });
db.raw_sensor_data.createIndex({ 'ttl_expiry': 1 }, { expireAfterSeconds: 0 });
db.raw_sensor_data.createIndex({ 'ingested_at': -1 });
db.raw_sensor_data.createIndex({ 'edge_node_id': 1 });

// ── OSINT Raw Feeds ──
db.createCollection('osint_raw_feeds', {
    validator: {
        $jsonSchema: {
            bsonType: 'object',
            required: ['source_type', 'source_id', 'content', 'collected_at'],
            properties: {
                source_type: { enum: ['twitter', 'telegram', 'reddit', 'news_rss', 'news_api', 'dark_web', 'paste_site', 'forum', 'blog', 'government_bulletin'] },
                source_id: { bsonType: 'string' },
                source_url: { bsonType: 'string' },
                source_name: { bsonType: 'string' },
                author: {
                    bsonType: 'object',
                    properties: {
                        id: { bsonType: 'string' },
                        username: { bsonType: 'string' },
                        display_name: { bsonType: 'string' },
                        followers_count: { bsonType: 'int' },
                        account_created_at: { bsonType: 'date' },
                        verified: { bsonType: 'bool' },
                        bot_score: { bsonType: 'double' }
                    }
                },
                content: {
                    bsonType: 'object',
                    required: ['text'],
                    properties: {
                        text: { bsonType: 'string' },
                        language: { bsonType: 'string' },
                        media_urls: { bsonType: 'array' },
                        hashtags: { bsonType: 'array' },
                        mentions: { bsonType: 'array' },
                        urls: { bsonType: 'array' },
                        title: { bsonType: 'string' }
                    }
                },
                engagement: {
                    bsonType: 'object',
                    properties: {
                        likes: { bsonType: 'int' },
                        shares: { bsonType: 'int' },
                        comments: { bsonType: 'int' },
                        views: { bsonType: 'int' }
                    }
                },
                location: {
                    bsonType: 'object',
                    properties: {
                        type: { enum: ['Point'] },
                        coordinates: { bsonType: 'array' }
                    }
                },
                nlp_results: {
                    bsonType: 'object',
                    properties: {
                        entities: { bsonType: 'array' },
                        sentiment: {
                            bsonType: 'object',
                            properties: {
                                label: { enum: ['positive', 'negative', 'neutral'] },
                                score: { bsonType: 'double' },
                                compound: { bsonType: 'double' }
                            }
                        },
                        keywords: { bsonType: 'array' },
                        topics: { bsonType: 'array' },
                        threat_indicators: { bsonType: 'array' },
                        language_detected: { bsonType: 'string' },
                        summary: { bsonType: 'string' },
                        misinformation_score: { bsonType: 'double' }
                    }
                },
                ollama_analysis: {
                    bsonType: 'object',
                    properties: {
                        summary: { bsonType: 'string' },
                        threat_assessment: { bsonType: 'string' },
                        entity_extraction: { bsonType: 'array' },
                        misinformation_analysis: { bsonType: 'string' },
                        confidence: { bsonType: 'double' },
                        model_used: { bsonType: 'string' },
                        analyzed_at: { bsonType: 'date' }
                    }
                },
                deduplication_hash: { bsonType: 'string' },
                classification: { enum: ['UNCLASSIFIED', 'CONFIDENTIAL', 'SECRET', 'TOP_SECRET', 'SCI'] },
                reliability: { enum: ['A_RELIABLE', 'B_USUALLY_RELIABLE', 'C_FAIRLY_RELIABLE', 'D_NOT_USUALLY_RELIABLE', 'E_UNRELIABLE', 'F_CANNOT_BE_JUDGED'] },
                is_processed: { bsonType: 'bool' },
                collected_at: { bsonType: 'date' },
                published_at: { bsonType: 'date' },
                processed_at: { bsonType: 'date' },
                ttl_expiry: { bsonType: 'date' }
            }
        }
    },
    storageEngine: {
        wiredTiger: {
            configString: 'block_compressor=zstd'
        }
    }
});

db.osint_raw_feeds.createIndex({ 'source_type': 1, 'collected_at': -1 });
db.osint_raw_feeds.createIndex({ 'deduplication_hash': 1 }, { unique: true, sparse: true });
db.osint_raw_feeds.createIndex({ 'content.text': 'text', 'content.title': 'text' }, { weights: { 'content.title': 10, 'content.text': 5 }, default_language: 'english' });
db.osint_raw_feeds.createIndex({ 'location': '2dsphere' });
db.osint_raw_feeds.createIndex({ 'nlp_results.entities.text': 1 });
db.osint_raw_feeds.createIndex({ 'nlp_results.threat_indicators': 1 });
db.osint_raw_feeds.createIndex({ 'nlp_results.sentiment.label': 1, 'collected_at': -1 });
db.osint_raw_feeds.createIndex({ 'is_processed': 1 }, { sparse: true });
db.osint_raw_feeds.createIndex({ 'ttl_expiry': 1 }, { expireAfterSeconds: 0 });
db.osint_raw_feeds.createIndex({ 'collected_at': -1 });
db.osint_raw_feeds.createIndex({ 'author.username': 1 });

// ── Suricata / IDS Logs ──
db.createCollection('ids_logs', {
    validator: {
        $jsonSchema: {
            bsonType: 'object',
            required: ['event_type', 'timestamp', 'src_ip', 'dest_ip'],
            properties: {
                event_type: { enum: ['alert', 'dns', 'http', 'tls', 'fileinfo', 'flow', 'netflow', 'anomaly', 'drop'] },
                timestamp: { bsonType: 'date' },
                src_ip: { bsonType: 'string' },
                src_port: { bsonType: 'int' },
                dest_ip: { bsonType: 'string' },
                dest_port: { bsonType: 'int' },
                proto: { bsonType: 'string' },
                alert: {
                    bsonType: 'object',
                    properties: {
                        action: { bsonType: 'string' },
                        gid: { bsonType: 'int' },
                        signature_id: { bsonType: 'int' },
                        rev: { bsonType: 'int' },
                        signature: { bsonType: 'string' },
                        category: { bsonType: 'string' },
                        severity: { bsonType: 'int' },
                        metadata: { bsonType: 'object' }
                    }
                },
                http: {
                    bsonType: 'object',
                    properties: {
                        hostname: { bsonType: 'string' },
                        url: { bsonType: 'string' },
                        http_method: { bsonType: 'string' },
                        http_user_agent: { bsonType: 'string' },
                        http_content_type: { bsonType: 'string' },
                        status: { bsonType: 'int' },
                        length: { bsonType: 'int' }
                    }
                },
                dns: {
                    bsonType: 'object',
                    properties: {
                        type: { bsonType: 'string' },
                        rrname: { bsonType: 'string' },
                        rrtype: { bsonType: 'string' },
                        rdata: { bsonType: 'string' },
                        rcode: { bsonType: 'string' }
                    }
                },
                tls: {
                    bsonType: 'object',
                    properties: {
                        sni: { bsonType: 'string' },
                        version: { bsonType: 'string' },
                        subject: { bsonType: 'string' },
                        issuerdn: { bsonType: 'string' },
                        ja3_hash: { bsonType: 'string' },
                        ja3s_hash: { bsonType: 'string' }
                    }
                },
                flow: {
                    bsonType: 'object',
                    properties: {
                        pkts_toserver: { bsonType: 'long' },
                        pkts_toclient: { bsonType: 'long' },
                        bytes_toserver: { bsonType: 'long' },
                        bytes_toclient: { bsonType: 'long' },
                        start: { bsonType: 'date' },
                        end: { bsonType: 'date' },
                        state: { bsonType: 'string' },
                        reason: { bsonType: 'string' }
                    }
                },
                geo_src: {
                    bsonType: 'object',
                    properties: {
                        country: { bsonType: 'string' },
                        city: { bsonType: 'string' },
                        latitude: { bsonType: 'double' },
                        longitude: { bsonType: 'double' },
                        asn: { bsonType: 'int' },
                        org: { bsonType: 'string' }
                    }
                },
                geo_dest: {
                    bsonType: 'object',
                    properties: {
                        country: { bsonType: 'string' },
                        city: { bsonType: 'string' },
                        latitude: { bsonType: 'double' },
                        longitude: { bsonType: 'double' },
                        asn: { bsonType: 'int' },
                        org: { bsonType: 'string' }
                    }
                },
                community_id: { bsonType: 'string' },
                raw_log: { bsonType: 'string' },
                ingested_at: { bsonType: 'date' }
            }
        }
    },
    storageEngine: {
        wiredTiger: {
            configString: 'block_compressor=zstd'
        }
    }
});

db.ids_logs.createIndex({ 'timestamp': -1 });
db.ids_logs.createIndex({ 'event_type': 1, 'timestamp': -1 });
db.ids_logs.createIndex({ 'src_ip': 1, 'timestamp': -1 });
db.ids_logs.createIndex({ 'dest_ip': 1, 'timestamp': -1 });
db.ids_logs.createIndex({ 'alert.signature_id': 1, 'timestamp': -1 });
db.ids_logs.createIndex({ 'alert.severity': 1, 'timestamp': -1 });
db.ids_logs.createIndex({ 'community_id': 1 });
db.ids_logs.createIndex({ 'tls.ja3_hash': 1 });
db.ids_logs.createIndex({ 'dns.rrname': 1 });

// ── Ingestion Pipeline Logs ──
db.createCollection('ingestion_logs', {
    validator: {
        $jsonSchema: {
            bsonType: 'object',
            required: ['pipeline_id', 'stage', 'status', 'timestamp'],
            properties: {
                pipeline_id: { bsonType: 'string' },
                source_type: { bsonType: 'string' },
                source_id: { bsonType: 'string' },
                stage: { enum: ['ingest', 'validate', 'transform', 'enrich', 'classify', 'route', 'store', 'edge_process'] },
                status: { enum: ['started', 'completed', 'failed', 'skipped', 'retrying'] },
                records_in: { bsonType: 'int' },
                records_out: { bsonType: 'int' },
                records_dropped: { bsonType: 'int' },
                duration_ms: { bsonType: 'int' },
                error: {
                    bsonType: 'object',
                    properties: {
                        code: { bsonType: 'string' },
                        message: { bsonType: 'string' },
                        stack: { bsonType: 'string' },
                        retry_count: { bsonType: 'int' }
                    }
                },
                metadata: { bsonType: 'object' },
                timestamp: { bsonType: 'date' }
            }
        }
    }
});

db.ingestion_logs.createIndex({ 'pipeline_id': 1, 'timestamp': -1 });
db.ingestion_logs.createIndex({ 'source_type': 1, 'timestamp': -1 });
db.ingestion_logs.createIndex({ 'status': 1, 'timestamp': -1 });
db.ingestion_logs.createIndex({ 'timestamp': -1 }, { expireAfterSeconds: 2592000 }); // 30 days

// ── Ollama Interaction Logs ──
db.createCollection('ollama_interactions', {
    validator: {
        $jsonSchema: {
            bsonType: 'object',
            required: ['model', 'prompt_type', 'prompt', 'response', 'timestamp'],
            properties: {
                model: { bsonType: 'string' },
                prompt_type: { enum: ['threat_investigation', 'intelligence_summary', 'natural_language_query', 'entity_extraction', 'misinformation_detection', 'decision_support', 'report_generation'] },
                prompt: { bsonType: 'string' },
                system_prompt: { bsonType: 'string' },
                context_documents: { bsonType: 'array' },
                response: { bsonType: 'string' },
                structured_output: { bsonType: 'object' },
                tokens_prompt: { bsonType: 'int' },
                tokens_response: { bsonType: 'int' },
                duration_ms: { bsonType: 'int' },
                temperature: { bsonType: 'double' },
                user_id: { bsonType: 'string' },
                session_id: { bsonType: 'string' },
                related_entity_ids: { bsonType: 'array' },
                feedback: {
                    bsonType: 'object',
                    properties: {
                        rating: { bsonType: 'int' },
                        is_accurate: { bsonType: 'bool' },
                        correction: { bsonType: 'string' },
                        submitted_by: { bsonType: 'string' },
                        submitted_at: { bsonType: 'date' }
                    }
                },
                classification: { enum: ['UNCLASSIFIED', 'CONFIDENTIAL', 'SECRET', 'TOP_SECRET', 'SCI'] },
                timestamp: { bsonType: 'date' }
            }
        }
    }
});

db.ollama_interactions.createIndex({ 'prompt_type': 1, 'timestamp': -1 });
db.ollama_interactions.createIndex({ 'model': 1, 'timestamp': -1 });
db.ollama_interactions.createIndex({ 'user_id': 1, 'timestamp': -1 });
db.ollama_interactions.createIndex({ 'session_id': 1, 'timestamp': -1 });
db.ollama_interactions.createIndex({ 'related_entity_ids': 1 });
db.ollama_interactions.createIndex({ 'timestamp': -1 });

// ── Webhook Delivery Logs ──
db.createCollection('webhook_deliveries', {
    validator: {
        $jsonSchema: {
            bsonType: 'object',
            required: ['webhook_id', 'source_ip', 'method', 'path', 'status_code', 'timestamp'],
            properties: {
                webhook_id: { bsonType: 'string' },
                source_ip: { bsonType: 'string' },
                method: { bsonType: 'string' },
                path: { bsonType: 'string' },
                headers: { bsonType: 'object' },
                body_size_bytes: { bsonType: 'int' },
                body_hash: { bsonType: 'string' },
                hmac_valid: { bsonType: 'bool' },
                status_code: { bsonType: 'int' },
                processing_duration_ms: { bsonType: 'int' },
                error: { bsonType: 'string' },
                kafka_topic: { bsonType: 'string' },
                kafka_partition: { bsonType: 'int' },
                kafka_offset: { bsonType: 'long' },
                timestamp: { bsonType: 'date' }
            }
        }
    }
});

db.webhook_deliveries.createIndex({ 'webhook_id': 1, 'timestamp': -1 });
db.webhook_deliveries.createIndex({ 'source_ip': 1, 'timestamp': -1 });
db.webhook_deliveries.createIndex({ 'hmac_valid': 1 }, { sparse: true });
db.webhook_deliveries.createIndex({ 'timestamp': -1 }, { expireAfterSeconds: 7776000 }); // 90 days

// ── Digital Twin State Snapshots ──
db.createCollection('digital_twin_snapshots', {
    validator: {
        $jsonSchema: {
            bsonType: 'object',
            required: ['simulation_id', 'tick', 'world_state', 'timestamp'],
            properties: {
                simulation_id: { bsonType: 'string' },
                tick: { bsonType: 'long' },
                world_state: {
                    bsonType: 'object',
                    properties: {
                        entities: { bsonType: 'array' },
                        sensors: { bsonType: 'array' },
                        threats: { bsonType: 'array' },
                        environment: { bsonType: 'object' }
                    }
                },
                events: { bsonType: 'array' },
                metrics: { bsonType: 'object' },
                timestamp: { bsonType: 'date' }
            }
        }
    }
});

db.digital_twin_snapshots.createIndex({ 'simulation_id': 1, 'tick': 1 });
db.digital_twin_snapshots.createIndex({ 'timestamp': -1 });
