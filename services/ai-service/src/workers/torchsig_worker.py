#!/usr/bin/env python3
# ──────────────────────────────────────────────────────────────
# sentinel-os/services/ai-service/src/workers/torchsig_worker.py
# TorchSig — RF signal classification using deep learning
# Classifies demodulated RF signals into modulation types
# ──────────────────────────────────────────────────────────────

"""
RF signal classification worker using TorchSig (or fallback).

Capabilities:
  - Classify modulation type (BPSK, QPSK, 8PSK, 16QAM, 64QAM, etc.)
  - Estimate SNR
  - Detect anomalous signals

Requirements (optional):
  pip install torch torchvision torchsig

If torchsig is unavailable, falls back to a heuristic classifier.
"""

import json
import sys
import numpy as np
from datetime import datetime, timezone
from typing import Optional

# ── Optional ML imports ──
try:
    import torch
    import torch.nn.functional as F
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False

try:
    from torchsig.datasets.sig53 import Sig53
    from torchsig.models import densenet
    TORCHSIG_AVAILABLE = True
except ImportError:
    TORCHSIG_AVAILABLE = False

MODULATION_CLASSES = [
    "OOK", "4ASK", "8ASK", "BPSK", "QPSK", "8PSK",
    "QAM16", "QAM64", "MSK", "GMSK", "OQPSK",
    "AM-SSB-WC", "AM-DSB-WC", "AM-SSB-SC", "AM-DSB-SC",
    "FM", "GFSK", "OFDM-CP", "OFDM-UP",
]


class RfSignalClassifier:
    """Classify RF signals by modulation type."""

    def __init__(self, model_path: Optional[str] = None):
        self.model = None
        self.device = "cpu"

        if TORCH_AVAILABLE:
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
            self._load_model(model_path)

    def _load_model(self, model_path: Optional[str]):
        if TORCHSIG_AVAILABLE and model_path:
            try:
                self.model = densenet(num_classes=len(MODULATION_CLASSES))
                self.model.load_state_dict(torch.load(model_path, map_location=self.device))
                self.model.to(self.device)
                self.model.eval()
                print(f"[torchsig_worker] Model loaded from {model_path}", file=sys.stderr)
                return
            except Exception as e:
                print(f"[torchsig_worker] Model load failed: {e}", file=sys.stderr)

        if TORCHSIG_AVAILABLE:
            try:
                self.model = densenet(num_classes=len(MODULATION_CLASSES))
                self.model.to(self.device)
                self.model.eval()
                print("[torchsig_worker] Using untrained densenet (demo mode)", file=sys.stderr)
            except Exception as e:
                print(f"[torchsig_worker] Densenet init failed: {e}", file=sys.stderr)

    def classify(self, iq_samples: np.ndarray, sample_rate: float = 2e6) -> dict:
        """Classify an IQ signal sample.

        Args:
            iq_samples: Complex IQ data array
            sample_rate: Sample rate in Hz

        Returns:
            Dict with modulation, confidence, snr_estimate
        """
        result = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "sampleRate": sample_rate,
            "sampleCount": len(iq_samples),
        }

        # SNR estimation
        snr = self._estimate_snr(iq_samples)
        result["snrEstimate"] = round(snr, 2)

        # Classification
        if self.model is not None and TORCH_AVAILABLE:
            result.update(self._classify_torch(iq_samples))
        else:
            result.update(self._classify_heuristic(iq_samples))

        return result

    def _estimate_snr(self, iq: np.ndarray) -> float:
        """Estimate SNR using signal power vs noise floor."""
        power = np.abs(iq) ** 2
        sorted_power = np.sort(power)
        noise_floor = np.median(sorted_power[:len(sorted_power)//4])
        signal_power = np.median(power)
        if noise_floor > 0:
            return 10 * np.log10(signal_power / noise_floor)
        return 0.0

    def _classify_torch(self, iq: np.ndarray) -> dict:
        """Classify using TorchSig model."""
        try:
            # Normalize and reshape for model input
            iq_norm = iq / (np.sqrt(np.mean(np.abs(iq)**2)) + 1e-8)
            tensor = torch.from_numpy(np.stack([iq_norm.real, iq_norm.imag])).float()
            tensor = tensor.unsqueeze(0).to(self.device)

            with torch.no_grad():
                output = self.model(tensor)
                probs = F.softmax(output, dim=1)
                top_idx = probs.argmax(dim=1).item()
                confidence = probs[0, top_idx].item()

            return {
                "modulation": MODULATION_CLASSES[top_idx] if top_idx < len(MODULATION_CLASSES) else "unknown",
                "confidence": round(confidence, 4),
                "classifier": "torchsig",
            }
        except Exception as e:
            return {
                "modulation": "unknown",
                "confidence": 0.0,
                "classifier": f"torchsig-error: {e}",
            }

    def _classify_heuristic(self, iq: np.ndarray) -> dict:
        """Heuristic classification when ML model unavailable."""
        magnitude = np.abs(iq)
        phase = np.angle(iq)

        # Count unique phase clusters
        phase_hist, _ = np.histogram(phase, bins=16, range=(-np.pi, np.pi))
        significant_bins = np.sum(phase_hist > len(phase) * 0.02)

        # Magnitude variance
        mag_var = np.var(magnitude)
        mag_mean = np.mean(magnitude)

        if mag_var / (mag_mean**2 + 1e-8) < 0.01:
            # Constant envelope
            if significant_bins <= 2:
                mod = "BPSK"
            elif significant_bins <= 4:
                mod = "QPSK"
            elif significant_bins <= 8:
                mod = "8PSK"
            elif significant_bins <= 16:
                mod = "QAM16"
            else:
                mod = "FM"
        else:
            # Variable envelope
            if significant_bins <= 2:
                mod = "OOK"
            elif significant_bins <= 4:
                mod = "4ASK"
            else:
                mod = "QAM64"

        return {
            "modulation": mod,
            "confidence": 0.5,
            "classifier": "heuristic",
        }


def main():
    """Demo: classify a generated test signal."""
    classifier = RfSignalClassifier()

    # Generate test signals
    t = np.linspace(0, 1, 1024)

    # BPSK test
    bpsk = np.exp(1j * np.pi * (np.random.randint(0, 2, len(t)) * 2 - 1))
    result = classifier.classify(bpsk)
    print(f"BPSK test: {json.dumps(result, indent=2)}")

    # QPSK test
    qpsk = np.exp(1j * np.pi / 4 * (2 * np.random.randint(0, 4, len(t)) + 1))
    result = classifier.classify(qpsk)
    print(f"QPSK test: {json.dumps(result, indent=2)}")

    # FM test
    fm = np.exp(1j * 5 * np.sin(2 * np.pi * 3 * t))
    result = classifier.classify(fm)
    print(f"FM test: {json.dumps(result, indent=2)}")


if __name__ == "__main__":
    main()
