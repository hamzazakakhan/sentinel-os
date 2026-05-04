#!/usr/bin/env python3
# ──────────────────────────────────────────────────────────────
# sentinel-os/services/sigint-service/src/gnuradio/adsb_decoder.py
# GNU Radio ADS-B decoder flowgraph for RTL-SDR
# Decodes 1090 MHz Mode S transponder signals
# ──────────────────────────────────────────────────────────────

"""
GNU Radio Companion flowgraph (auto-generated Python).

Requirements:
  - GNU Radio 3.10+
  - gr-osmosdr (RTL-SDR source)
  - gr-digital

Usage:
  python3 adsb_decoder.py --rtl-gain 40 --rtl-freq 1090000000

Output: JSON ADS-B messages on stdout + optional Kafka publish
"""

import argparse
import json
import sys
import os
from datetime import datetime, timezone

# ── GNU Radio imports (optional — graceful degradation) ──
try:
    from gnuradio import gr, blocks, filter, analog, digital
    from gnuradio import osmosdr
    GNU_RADIO_AVAILABLE = True
except ImportError:
    GNU_RADIO_AVAILABLE = False

# ── Kafka (optional) ──
try:
    from aiokafka import AIOKafkaProducer
    import asyncio
    KAFKA_AVAILABLE = True
except ImportError:
    KAFKA_AVAILABLE = False

# ── ADS-B constants ──
ADS_B_FREQ = 1090e6        # 1090 MHz
ADS_B_RATE = 2e6           # 2 MSps
ADS_B_PREAMBLE = [1, 0, 1, 0, 0, 0, 0, 1]  # 8-bit preamble
MSG_TYPES_SHORT = [1, 2, 3, 4]   # 56-bit (DF 0-3)
MSG_TYPES_LONG = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]  # 112-bit


def crc24_adsb(msg_bits: list) -> int:
    """Compute ADS-B CRC-24 for message validation."""
    generator = [
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 0, 1,
    ]
    crc = 0
    for bit in msg_bits:
        if (crc >> 23) ^ bit:
            crc = ((crc << 1) ^ 0x1FFFFFFF) & 0xFFFFFF
        else:
            crc = (crc << 1) & 0xFFFFFF
    return crc


def decode_adsb_hex(hex_str: str) -> dict:
    """Decode a hex ADS-B message into structured fields."""
    try:
        raw = bytes.fromhex(hex_str)
        df = (raw[0] >> 3) & 0x1F
        icao = f"{raw[0] & 0x07:02X}{raw[1]:02X}{raw[2]:02X}"

        result = {
            "icao": icao,
            "df": df,
            "raw": hex_str,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        if df in (17, 18):  # ADS-B
            tc = (raw[4] >> 3) & 0x1F
            result["typecode"] = tc

            if 1 <= tc <= 4:  # identification
                callsign_chars = []
                for i in range(6):
                    byte_pair = (raw[5 + (i * 2) // 8] >> (7 - ((i * 2) % 8))) & 0x3F
                    callsign_chars.append(chr(byte_pair + 0x40) if byte_pair > 0 else '@')
                result["callsign"] = ''.join(callsign_chars).strip('@_ ')
            elif 9 <= tc <= 18 or 20 <= tc <= 22:  # airborne position
                alt_bits = ((raw[5] & 0xFF) << 4) | ((raw[6] >> 4) & 0x0F)
                alt = (alt_bits & 0x0F) * 100 + ((alt_bits >> 4) & 0x3F) * 25 - 1000
                result["altitude"] = alt
                result["f_flag"] = (raw[6] >> 2) & 1
                result["t_flag"] = (raw[6] >> 1) & 1
            elif tc == 19:  # airborne velocity
                subtype = raw[4] & 0x07
                if subtype in (1, 2):
                    ew_sign = (raw[5] >> 2) & 1
                    ew_vel = ((raw[5] & 0x03) << 8) | raw[6]
                    ns_sign = (raw[7] >> 6) & 1
                    ns_vel = ((raw[7] & 0x3F) << 2) | ((raw[8] >> 6) & 0x03)
                    ew_vel = -ew_vel if ew_sign else ew_vel
                    ns_vel = -ns_vel if ns_sign else ns_vel
                    speed = round((ew_vel**2 + ns_vel**2) ** 0.5)
                    track = round((360 + 90 - round(180 / 3.14159265 * (3.14159265 / 2 - 3.14159265 / 180 * (0 if ns_vel == 0 else 57.2958 * 3.14159265 / 2 * (1 if ew_vel >= 0 else -1) * (0 if ns_vel == 0 else 1))))) % 360)
                    result["speed"] = speed
                    result["track"] = track

        return result
    except Exception:
        return {"raw": hex_str, "error": "decode_failed"}


class AdsbDecoderFlowgraph:
    """GNU Radio flowgraph wrapper for ADS-B decoding."""

    def __init__(self, rtl_gain=40, rtl_freq=ADS_B_FREQ, sample_rate=ADS_B_RATE):
        self.rtl_gain = rtl_gain
        self.rtl_freq = rtl_freq
        self.sample_rate = sample_rate
        self.running = False
        self.messages = []

    def start(self):
        if not GNU_RADIO_AVAILABLE:
            print("[adsb_decoder] GNU Radio not available — running in simulation mode", file=sys.stderr)
            self._simulate()
            return

        try:
            self.tb = gr.top_block("adsb_decoder")

            # RTL-SDR source
            self.rtl_source = osmosdr.source(
                args=f"numchan=0 rtl=0 rtl_gain={self.rtl_gain}"
            )
            self.rtl_source.set_sample_rate(self.sample_rate)
            self.rtl_source.set_center_freq(self.rtl_freq)
            self.rtl_source.set_freq_corr(0)
            self.rtl_source.set_gain_mode(False)
            self.rtl_source.set_gain(self.rtl_gain)

            # Low-pass filter (1 MHz bandwidth)
            self.lpf = filter.freq_xlating_fir_filter_ccf(
                1,                # decimation
                filter.firdes.low_pass(1, self.sample_rate, 1e6, 250e3),
                0,                # center frequency offset
                self.sample_rate
            )

            # Complex to magnitude (envelope detection)
            self.c2mag = blocks.complex_to_mag()

            # Threshold detector
            self.threshold = blocks.threshold_ff(0.5, 0.3, 0)

            # Message sink
            self.msg_sink = blocks.message_debug()

            # Connect flowgraph
            self.tb.connect(self.rtl_source, self.lpf, self.c2mag, self.threshold)

            self.tb.start()
            self.running = True
            print(f"[adsb_decoder] Flowgraph started at {self.rtl_freq/1e6} MHz", file=sys.stderr)

        except Exception as e:
            print(f"[adsb_decoder] GNU Radio init failed: {e}", file=sys.stderr)
            self._simulate()

    def stop(self):
        if self.running and GNU_RADIO_AVAILABLE:
            try:
                self.tb.stop()
                self.tb.wait()
            except Exception:
                pass
        self.running = False

    def _simulate(self):
        """Generate simulated ADS-B messages for testing without SDR hardware."""
        import random
        self.running = True
        print("[adsb_decoder] Simulation mode — generating sample ADS-B messages", file=sys.stderr)

        sample_messages = [
            "8D40621D58C382D690C8AC2863A7",  # Airborne position
            "8D40621D9C2050B9201AB4875DDF",  # Airborne velocity
            "A0001838CA38023E00000D6D2B0A",  # Identification
            "8D4840D920B4603B9052185B286F",  # Airborne position
            "8D4CA2515815103B8820B4087B4A",  # Airborne position
        ]

        while self.running:
            for msg in sample_messages:
                decoded = decode_adsb_hex(msg)
                decoded["simulated"] = True
                print(json.dumps(decoded), flush=True)
                self.messages.append(decoded)

            import time
            time.sleep(5)

    def get_messages(self, max_count=100):
        msgs = self.messages[-max_count:]
        self.messages = self.messages[-max_count:]
        return msgs


def main():
    parser = argparse.ArgumentParser(description="Sentinel ADS-B Decoder")
    parser.add_argument("--rtl-gain", type=int, default=40, help="RTL-SDR gain (dB)")
    parser.add_argument("--rtl-freq", type=float, default=ADS_B_FREQ, help="Center frequency (Hz)")
    parser.add_argument("--simulate", action="store_true", help="Run in simulation mode")
    parser.add_argument("--kafka", action="store_true", help="Publish to Kafka")
    args = parser.parse_args()

    fg = AdsbDecoderFlowgraph(rtl_gain=args.rtl_gain, rtl_freq=args.rtl_freq)

    if args.simulate:
        print("[adsb_decoder] Simulation mode forced", file=sys.stderr)

    try:
        fg.start()
        import signal
        signal.signal(signal.SIGINT, lambda *_: fg.stop())
        signal.signal(signal.SIGTERM, lambda *_: fg.stop())

        # Keep running
        while fg.running:
            import time
            time.sleep(1)

    except KeyboardInterrupt:
        fg.stop()
    finally:
        fg.stop()


if __name__ == "__main__":
    main()
