package connectors

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os/exec"
	"sync"
	"time"

	"github.com/google/uuid"
)

type RTSPConfig struct {
	URL          string `json:"url"`
	SensorID     string `json:"sensor_id"`
	FPS          int    `json:"fps"`
	Resolution   string `json:"resolution"`
	AIEndpoint   string `json:"ai_endpoint"`
	BufferFrames int    `json:"buffer_frames"`
}

type RTSPConnector struct {
	config     RTSPConfig
	mu         sync.RWMutex
	running    bool
	cancel     context.CancelFunc
	frameCount int64
	publishFn  func(topic string, key string, payload interface{}) error
}

type FrameDetection struct {
	ID         string    `json:"id"`
	SensorID   string    `json:"sensor_id"`
	Timestamp  time.Time `json:"timestamp"`
	FrameNum   int64     `json:"frame_num"`
	Detections []struct {
		Label      string    `json:"label"`
		Confidence float64   `json:"confidence"`
		BBox       []float64 `json:"bbox"`
	} `json:"detections"`
}

func NewRTSPConnector(cfg RTSPConfig, publishFn func(string, string, interface{}) error) *RTSPConnector {
	if cfg.FPS == 0 {
		cfg.FPS = 5
	}
	if cfg.Resolution == "" {
		cfg.Resolution = "640x480"
	}
	if cfg.BufferFrames == 0 {
		cfg.BufferFrames = 30
	}
	return &RTSPConnector{config: cfg, publishFn: publishFn}
}

func (r *RTSPConnector) Start(ctx context.Context) error {
	r.mu.Lock()
	if r.running {
		r.mu.Unlock()
		return fmt.Errorf("already running")
	}
	childCtx, cancel := context.WithCancel(ctx)
	r.cancel = cancel
	r.running = true
	r.mu.Unlock()

	go r.captureLoop(childCtx)
	log.Printf("[RTSP] Started capture for sensor %s from %s", r.config.SensorID, r.config.URL)
	return nil
}

func (r *RTSPConnector) Stop() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cancel != nil {
		r.cancel()
	}
	r.running = false
}

func (r *RTSPConnector) captureLoop(ctx context.Context) {
	ticker := time.NewTicker(time.Second / time.Duration(r.config.FPS))
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.mu.Lock()
			r.frameCount++
			frame := r.frameCount
			r.mu.Unlock()

			// In production: capture frame via ffmpeg/GStreamer, send to AI service
			// Here we use ffmpeg to grab a single frame
			go r.processFrame(ctx, frame)
		}
	}
}

func (r *RTSPConnector) processFrame(ctx context.Context, frameNum int64) {
	// Capture single frame using ffmpeg
	cmd := exec.CommandContext(ctx, "ffmpeg",
		"-rtsp_transport", "tcp",
		"-i", r.config.URL,
		"-frames:v", "1",
		"-f", "image2pipe",
		"-vcodec", "mjpeg",
		"-",
	)

	output, err := cmd.Output()
	if err != nil {
		// Non-fatal: camera may be temporarily unavailable
		return
	}

	if len(output) == 0 {
		return
	}

	// Send to AI service for detection
	detection := FrameDetection{
		ID:        uuid.New().String(),
		SensorID:  r.config.SensorID,
		Timestamp: time.Now().UTC(),
		FrameNum:  frameNum,
	}

	// Publish frame event to Kafka
	if r.publishFn != nil {
		r.publishFn("sentinel.detections", r.config.SensorID, detection)
	}
}

func (r *RTSPConnector) Stats() map[string]interface{} {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return map[string]interface{}{
		"sensor_id":   r.config.SensorID,
		"running":     r.running,
		"frame_count": r.frameCount,
		"url":         r.config.URL,
	}
}

// ── MQTT Sensor Connector ────────────────────────────────────

type MQTTConfig struct {
	BrokerURL    string   `json:"broker_url"`
	Topics       []string `json:"topics"`
	ClientID     string   `json:"client_id"`
	Username     string   `json:"username"`
	Password     string   `json:"password"`
	QoS          byte     `json:"qos"`
	CleanSession bool     `json:"clean_session"`
}

type MQTTMessage struct {
	Topic     string          `json:"topic"`
	Payload   json.RawMessage `json:"payload"`
	QoS       byte            `json:"qos"`
	Timestamp time.Time       `json:"timestamp"`
	SensorID  string          `json:"sensor_id"`
}

// ── Radar Connector ──────────────────────────────────────────

type RadarConfig struct {
	Host       string  `json:"host"`
	Port       int     `json:"port"`
	SensorID   string  `json:"sensor_id"`
	Protocol   string  `json:"protocol"` // ASTERIX, custom
	MaxRangeKm float64 `json:"max_range_km"`
	ScanRateHz float64 `json:"scan_rate_hz"`
}

type RadarTrack struct {
	ID        string    `json:"id"`
	SensorID  string    `json:"sensor_id"`
	TrackID   int       `json:"track_id"`
	Latitude  float64   `json:"latitude"`
	Longitude float64   `json:"longitude"`
	Altitude  float64   `json:"altitude_m"`
	Speed     float64   `json:"speed_mps"`
	Heading   float64   `json:"heading_deg"`
	RCS       float64   `json:"rcs_dbsm"`
	Timestamp time.Time `json:"timestamp"`
}

type RadarConnector struct {
	config    RadarConfig
	running   bool
	mu        sync.RWMutex
	publishFn func(string, string, interface{}) error
}

func NewRadarConnector(cfg RadarConfig, publishFn func(string, string, interface{}) error) *RadarConnector {
	return &RadarConnector{config: cfg, publishFn: publishFn}
}

func (r *RadarConnector) Start(ctx context.Context) error {
	r.mu.Lock()
	r.running = true
	r.mu.Unlock()

	go func() {
		// In production: connect to radar via TCP/UDP, parse ASTERIX CAT-048/062
		ticker := time.NewTicker(time.Second / time.Duration(r.config.ScanRateHz))
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				r.mu.Lock()
				r.running = false
				r.mu.Unlock()
				return
			case <-ticker.C:
				// Parse radar data and publish tracks
			}
		}
	}()
	log.Printf("[RADAR] Started connector for %s at %s:%d", r.config.SensorID, r.config.Host, r.config.Port)
	return nil
}

// ── Drone Connector ──────────────────────────────────────────

type DroneConfig struct {
	Host       string `json:"host"`
	Port       int    `json:"port"`
	DroneID    string `json:"drone_id"`
	Protocol   string `json:"protocol"` // MAVLink, DJI
	StreamURL  string `json:"stream_url"`
}

type DroneTelemetry struct {
	DroneID    string    `json:"drone_id"`
	Latitude   float64   `json:"latitude"`
	Longitude  float64   `json:"longitude"`
	AltitudeM  float64   `json:"altitude_m"`
	SpeedMPS   float64   `json:"speed_mps"`
	HeadingDeg float64   `json:"heading_deg"`
	BatteryPct float64   `json:"battery_pct"`
	Status     string    `json:"status"`
	Timestamp  time.Time `json:"timestamp"`
}

type DroneConnector struct {
	config    DroneConfig
	running   bool
	mu        sync.RWMutex
	publishFn func(string, string, interface{}) error
}

func NewDroneConnector(cfg DroneConfig, publishFn func(string, string, interface{}) error) *DroneConnector {
	return &DroneConnector{config: cfg, publishFn: publishFn}
}

func (d *DroneConnector) Start(ctx context.Context) error {
	d.mu.Lock()
	d.running = true
	d.mu.Unlock()

	go func() {
		// In production: connect via MAVLink, parse telemetry
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				d.mu.Lock()
				d.running = false
				d.mu.Unlock()
				return
			case <-ticker.C:
				// Read MAVLink heartbeat, GPS, attitude messages
			}
		}
	}()
	log.Printf("[DRONE] Started connector for %s via %s", d.config.DroneID, d.config.Protocol)
	return nil
}

func (d *DroneConnector) SendCommand(cmd string, params map[string]interface{}) error {
	d.mu.RLock()
	defer d.mu.RUnlock()
	if !d.running {
		return fmt.Errorf("drone not connected")
	}
	log.Printf("[DRONE] Command %s -> %s: %v", cmd, d.config.DroneID, params)
	// In production: encode MAVLink command and send
	return nil
}
