package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/google/uuid"
	"github.com/gorilla/mux"
	mqtt "github.com/eclipse/paho.mqtt.golang"
)

type Config struct {
	Port           string
	KafkaBrokers   string
	MQTTBroker     string
	RTSPEndpoints  []string
}

type Event struct {
	ID        string                 `json:"id"`
	Source    string                 `json:"source"`
	Type     string                 `json:"type"`
	Timestamp string                `json:"timestamp"`
	Payload  map[string]interface{} `json:"payload"`
}

type IngestionServer struct {
	config   Config
	producer *kafka.Producer
	router   *mux.Router
	mu       sync.RWMutex
	stats    IngestionStats
}

type IngestionStats struct {
	EventsIngested  int64 `json:"events_ingested"`
	EventsDropped   int64 `json:"events_dropped"`
	BytesProcessed  int64 `json:"bytes_processed"`
	ActiveSources   int   `json:"active_sources"`
	UptimeSeconds   int64 `json:"uptime_seconds"`
}

func loadConfig() Config {
	port := os.Getenv("INGESTION_PORT")
	if port == "" {
		port = "5000"
	}
	brokers := os.Getenv("KAFKA_BROKERS")
	if brokers == "" {
		brokers = "localhost:9092"
	}
	mqttBroker := os.Getenv("MQTT_BROKER")
	if mqttBroker == "" {
		mqttBroker = "tcp://localhost:1883"
	}
	return Config{
		Port:         port,
		KafkaBrokers: brokers,
		MQTTBroker:   mqttBroker,
	}
}

func NewIngestionServer(cfg Config) (*IngestionServer, error) {
	p, err := kafka.NewProducer(&kafka.ConfigMap{
		"bootstrap.servers":   cfg.KafkaBrokers,
		"acks":                "all",
		"retries":             3,
		"linger.ms":           5,
		"compression.type":    "lz4",
		"batch.num.messages":  1000,
		"queue.buffering.max.messages": 100000,
	})
	if err != nil {
		return nil, fmt.Errorf("kafka producer: %w", err)
	}

	s := &IngestionServer{
		config:   cfg,
		producer: p,
		router:   mux.NewRouter(),
	}
	s.setupRoutes()

	// Delivery reports
	go func() {
		for e := range p.Events() {
			switch ev := e.(type) {
			case *kafka.Message:
				if ev.TopicPartition.Error != nil {
					log.Printf("delivery failed: %v", ev.TopicPartition.Error)
					s.mu.Lock()
					s.stats.EventsDropped++
					s.mu.Unlock()
				}
			}
		}
	}()

	return s, nil
}

func (s *IngestionServer) setupRoutes() {
	s.router.HandleFunc("/healthz", s.handleHealth).Methods("GET")
	s.router.HandleFunc("/metrics", s.handleMetrics).Methods("GET")
	s.router.HandleFunc("/api/v1/ingest/webhook", s.handleWebhook).Methods("POST")
	s.router.HandleFunc("/api/v1/ingest/sensor/{sensorId}/heartbeat", s.handleHeartbeat).Methods("POST")
	s.router.HandleFunc("/api/v1/ingest/detection", s.handleDetection).Methods("POST")
	s.router.HandleFunc("/api/v1/ingest/cyber-event", s.handleCyberEvent).Methods("POST")
	s.router.HandleFunc("/api/v1/ingest/batch", s.handleBatch).Methods("POST")
}

func (s *IngestionServer) publishToKafka(topic string, key string, payload interface{}) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	t := topic
	err = s.producer.Produce(&kafka.Message{
		TopicPartition: kafka.TopicPartition{Topic: &t, Partition: kafka.PartitionAny},
		Key:            []byte(key),
		Value:          data,
		Timestamp:      time.Now(),
		Headers: []kafka.Header{
			{Key: "source", Value: []byte("ingestion-service")},
			{Key: "content-type", Value: []byte("application/json")},
		},
	}, nil)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.stats.EventsIngested++
	s.stats.BytesProcessed += int64(len(data))
	s.mu.Unlock()
	return nil
}

func (s *IngestionServer) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "ingestion-service"})
}

func (s *IngestionServer) handleMetrics(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(s.stats)
}

func (s *IngestionServer) handleWebhook(w http.ResponseWriter, r *http.Request) {
	var event Event
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}
	if event.ID == "" {
		event.ID = uuid.New().String()
	}
	if event.Timestamp == "" {
		event.Timestamp = time.Now().UTC().Format(time.RFC3339Nano)
	}

	topic := "sentinel.detections"
	if event.Type == "cyber" {
		topic = "sentinel.cyber.events"
	} else if event.Type == "osint" {
		topic = "sentinel.osint.items"
	}

	if err := s.publishToKafka(topic, event.ID, event); err != nil {
		http.Error(w, `{"error":"publish failed"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]string{"status": "accepted", "id": event.ID})
}

func (s *IngestionServer) handleHeartbeat(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sensorId := vars["sensorId"]
	var payload map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}
	payload["sensor_id"] = sensorId
	payload["timestamp"] = time.Now().UTC().Format(time.RFC3339Nano)

	if err := s.publishToKafka("sentinel.sensor.heartbeats", sensorId, payload); err != nil {
		http.Error(w, `{"error":"publish failed"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]string{"status": "accepted"})
}

func (s *IngestionServer) handleDetection(w http.ResponseWriter, r *http.Request) {
	var payload map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}
	id := uuid.New().String()
	payload["id"] = id
	payload["ingested_at"] = time.Now().UTC().Format(time.RFC3339Nano)

	if err := s.publishToKafka("sentinel.detections", id, payload); err != nil {
		http.Error(w, `{"error":"publish failed"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]string{"status": "accepted", "id": id})
}

func (s *IngestionServer) handleCyberEvent(w http.ResponseWriter, r *http.Request) {
	var payload map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}
	id := uuid.New().String()
	payload["id"] = id
	payload["ingested_at"] = time.Now().UTC().Format(time.RFC3339Nano)

	if err := s.publishToKafka("sentinel.cyber.events", id, payload); err != nil {
		http.Error(w, `{"error":"publish failed"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]string{"status": "accepted", "id": id})
}

func (s *IngestionServer) handleBatch(w http.ResponseWriter, r *http.Request) {
	var events []Event
	if err := json.NewDecoder(r.Body).Decode(&events); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}
	accepted := 0
	for _, event := range events {
		if event.ID == "" {
			event.ID = uuid.New().String()
		}
		topic := "sentinel.detections"
		if event.Type == "cyber" {
			topic = "sentinel.cyber.events"
		}
		if err := s.publishToKafka(topic, event.ID, event); err == nil {
			accepted++
		}
	}
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]interface{}{"accepted": accepted, "total": len(events)})
}

func (s *IngestionServer) startMQTT() {
	opts := mqtt.NewClientOptions().
		AddBroker(s.config.MQTTBroker).
		SetClientID("sentinel-ingestion").
		SetAutoReconnect(true).
		SetConnectRetry(true).
		SetConnectRetryInterval(5 * time.Second)

	client := mqtt.NewClient(opts)
	if token := client.Connect(); token.Wait() && token.Error() != nil {
		log.Printf("MQTT connect failed (non-fatal): %v", token.Error())
		return
	}

	topics := map[string]byte{
		"sentinel/sensors/+/heartbeat":  1,
		"sentinel/sensors/+/detection":  1,
		"sentinel/sensors/+/telemetry":  1,
	}

	client.SubscribeMultiple(topics, func(c mqtt.Client, msg mqtt.Message) {
		var payload map[string]interface{}
		if err := json.Unmarshal(msg.Payload(), &payload); err != nil {
			return
		}
		payload["mqtt_topic"] = msg.Topic()
		s.publishToKafka("sentinel.sensor.heartbeats", msg.Topic(), payload)
	})

	log.Println("MQTT subscriber started")
}

func main() {
	cfg := loadConfig()
	server, err := NewIngestionServer(cfg)
	if err != nil {
		log.Fatalf("failed to create server: %v", err)
	}

	// Start MQTT in background (non-blocking)
	go server.startMQTT()

	httpServer := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      server.router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Printf("ingestion-service listening on :%s", cfg.Port)
		if err := httpServer.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	httpServer.Shutdown(ctx)
	server.producer.Flush(5000)
	server.producer.Close()
}
