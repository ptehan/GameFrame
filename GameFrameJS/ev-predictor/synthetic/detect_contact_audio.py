"""Detect a likely bat-contact time from the video's audio transient."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
import subprocess
import tempfile

import numpy as np


def extract_audio(video: Path, sample_rate: int) -> np.ndarray:
    with tempfile.NamedTemporaryFile(suffix=".s16le", delete=False) as tmp:
        raw_path = Path(tmp.name)
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(video),
                "-vn",
                "-ac",
                "1",
                "-ar",
                str(sample_rate),
                "-f",
                "s16le",
                str(raw_path),
            ],
            check=True,
        )
        pcm = np.fromfile(raw_path, dtype=np.int16).astype(np.float32)
        return pcm / 32768.0
    finally:
        raw_path.unlink(missing_ok=True)


def frame_features(audio: np.ndarray, sample_rate: int, window_ms: float) -> list[dict]:
    window = max(64, int(sample_rate * window_ms / 1000.0))
    hop = max(16, window // 4)
    rows = []
    prev_rms = 1e-6
    for start in range(0, max(1, len(audio) - window), hop):
        chunk = audio[start : start + window]
        if len(chunk) < window:
            break
        rms = float(np.sqrt(np.mean(chunk * chunk)))
        peak = float(np.max(np.abs(chunk)))
        derivative = np.diff(chunk, prepend=chunk[0])
        crack = float(np.quantile(np.abs(derivative), 0.995))
        rise = rms / max(prev_rms, 1e-6)
        rows.append(
            {
                "time_s": start / sample_rate,
                "rms": rms,
                "peak": peak,
                "crack": crack,
                "rise": rise,
                "score": peak * 1.4 + crack * 2.2 + min(rise, 8.0) * 0.08,
            }
        )
        prev_rms = max(rms, 1e-6)
    return rows


def detect_contact(rows: list[dict], search_start_s: float | None, search_end_s: float | None, lead_s: float) -> dict:
    candidates = rows
    if search_start_s is not None:
        candidates = [row for row in candidates if row["time_s"] >= search_start_s]
    if search_end_s is not None:
        candidates = [row for row in candidates if row["time_s"] <= search_end_s]
    if not candidates:
        raise ValueError("No audio frames in requested search window.")

    baseline_scores = np.array([row["score"] for row in rows], dtype=float)
    baseline = float(np.median(baseline_scores))
    mad = float(np.median(np.abs(baseline_scores - baseline))) or 1e-6
    robust_scale = 1.4826 * mad
    loudest = max(candidates, key=lambda row: row["score"])
    loud_threshold = max(baseline + 3.0 * robust_scale, float(loudest["score"]) * 0.35)
    best = next(
        (row for row in candidates if row["time_s"] >= 0.15 and row["score"] >= loud_threshold),
        loudest,
    )
    z = (float(best["score"]) - baseline) / robust_scale
    proposed_contact = max(0.0, float(best["time_s"]) - lead_s)
    confidence = "HIGH" if z >= 12 else "MEDIUM" if z >= 7 else "LOW"
    return {
        "audio_crack_time_s": round(float(best["time_s"]), 6),
        "proposed_contact_time_s": round(proposed_contact, 6),
        "lead_s": round(lead_s, 6),
        "score": round(float(best["score"]), 6),
        "robust_z": round(float(z), 3),
        "confidence": confidence,
        "method": "first_loud_audio_transient_v1",
    }


def write_csv(rows: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["time_s", "rms", "peak", "crack", "rise", "score"])
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", default=Path(r"C:\Users\Patrick\Downloads\InShot_20260704_065621235.mp4"), type=Path)
    parser.add_argument("--out", default=Path("comparison_output/contact_audio_proposal.json"), type=Path)
    parser.add_argument("--csv", default=Path("analysis_frames/contact_audio_features.csv"), type=Path)
    parser.add_argument("--sample-rate", default=16000, type=int)
    parser.add_argument("--window-ms", default=8.0, type=float)
    parser.add_argument("--lead-s", default=0.0, type=float)
    parser.add_argument("--search-start-s", default=None, type=float)
    parser.add_argument("--search-end-s", default=None, type=float)
    args = parser.parse_args()

    audio = extract_audio(args.video, args.sample_rate)
    rows = frame_features(audio, args.sample_rate, args.window_ms)
    proposal = detect_contact(rows, args.search_start_s, args.search_end_s, args.lead_s)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(proposal, indent=2), encoding="utf-8")
    write_csv(rows, args.csv)
    print(json.dumps(proposal, indent=2))
    print(f"Wrote {args.out}")
    print(f"Wrote {args.csv}")


if __name__ == "__main__":
    main()
