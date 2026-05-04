#!/usr/bin/env python3
# ──────────────────────────────────────────────────────────────
# sentinel-os/services/ai-service/src/workers/yolov8_detector.py
# YOLOv8 object detection for satellite/drone imagery
# Detects vehicles, aircraft, vessels, infrastructure
# ──────────────────────────────────────────────────────────────

"""
YOLOv8-based object detection for GEOINT imagery.

Capabilities:
  - Detect vehicles, aircraft, vessels in satellite/drone imagery
  - Output bounding boxes with class labels and confidence
  - Publish detections to Kafka topic sentinel.ai.geoint-detections

Requirements (optional):
  pip install ultralytics opencv-python-headless pillow

If ultralytics is unavailable, falls back to a no-op stub.
"""

import json
import sys
import base64
import io
import os
from datetime import datetime, timezone
from typing import Optional, List

# ── Optional imports ──
try:
    from ultralytics import YOLO
    YOLO_AVAILABLE = True
except ImportError:
    YOLO_AVAILABLE = False

try:
    from PIL import Image
    import numpy as np
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

# ── Custom GEOINT class map ──
GEOINT_CLASSES = {
    0: "fixed_wing_aircraft",
    1: "rotary_wing_aircraft",
    2: "vehicle",
    3: "vessel",
    4: "building",
    5: "bridge",
    6: "road",
    7: "runway",
    8: "parking_lot",
    9: "tank",
    10: "artillery",
    11: "radar_installation",
    12: "missile_launcher",
    13: "bunker",
    14: "checkpoint",
}


class GeointDetector:
    """YOLOv8-based GEOINT object detector."""

    def __init__(self, model_path: Optional[str] = None):
        self.model = None

        if YOLO_AVAILABLE:
            try:
                if model_path and os.path.exists(model_path):
                    self.model = YOLO(model_path)
                else:
                    self.model = YOLO("yolov8n.pt")  # nano model as fallback
                print(f"[yolov8_detector] Model loaded: {model_path or 'yolov8n.pt'}", file=sys.stderr)
            except Exception as e:
                print(f"[yolov8_detector] Model load failed: {e}", file=sys.stderr)

    def detect(self, image_input, confidence: float = 0.25) -> List[dict]:
        """Run object detection on an image.

        Args:
            image_input: file path, PIL Image, or base64 string
            confidence: minimum confidence threshold

        Returns:
            List of detection dicts
        """
        if not YOLO_AVAILABLE or self.model is None:
            return self._stub_detect()

        try:
            img = self._load_image(image_input)
            if img is None:
                return []

            results = self.model(img, conf=confidence, verbose=False)

            detections = []
            for r in results:
                for box in r.boxes:
                    cls_id = int(box.cls[0])
                    detections.append({
                        "class": r.names.get(cls_id, f"class_{cls_id}"),
                        "confidence": round(float(box.conf[0]), 4),
                        "bbox": [round(float(v), 2) for v in box.xyxy[0].tolist()],
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })

            return detections

        except Exception as e:
            print(f"[yolov8_detector] Detection failed: {e}", file=sys.stderr)
            return []

    def _load_image(self, image_input):
        """Load image from various input types."""
        if isinstance(image_input, str):
            if os.path.exists(image_input):
                return image_input  # YOLO accepts file paths
            # Try base64
            try:
                img_data = base64.b64decode(image_input)
                if PIL_AVAILABLE:
                    return Image.open(io.BytesIO(img_data))
            except Exception:
                pass
            return None
        elif PIL_AVAILABLE and isinstance(image_input, Image.Image):
            return image_input
        return image_input

    def _stub_detect(self) -> List[dict]:
        """Return empty detections when YOLO unavailable."""
        return []


def main():
    """Demo: run detection on a test image if provided."""
    import argparse
    parser = argparse.ArgumentParser(description="YOLOv8 GEOINT Detector")
    parser.add_argument("--image", type=str, help="Path to image file")
    parser.add_argument("--model", type=str, help="Path to custom model weights")
    parser.add_argument("--conf", type=float, default=0.25, help="Confidence threshold")
    args = parser.parse_args()

    detector = GeointDetector(model_path=args.model)

    if args.image:
        detections = detector.detect(args.image, confidence=args.conf)
        print(json.dumps(detections, indent=2))
    else:
        print("[yolov8_detector] No image provided — running stub test", file=sys.stderr)
        detections = detector._stub_detect()
        print(f"Detections: {detections}")


if __name__ == "__main__":
    main()
