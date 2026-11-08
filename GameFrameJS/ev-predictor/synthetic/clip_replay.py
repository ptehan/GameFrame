"""Render an export clip with title cards and an annotated estimate banner."""

from __future__ import annotations

import argparse
import base64
import json
import math
import os
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
VIDEO_LOGO_PATH = ROOT / "assets" / "gameframe-logo-video.png"
VIDEO_LOGO = cv2.imread(str(VIDEO_LOGO_PATH), cv2.IMREAD_UNCHANGED) if VIDEO_LOGO_PATH.exists() else None


@lru_cache(maxsize=1)
def video_encoder() -> str:
    requested = os.environ.get('EV_VIDEO_ENCODER', 'auto')
    if requested in ('libx264', 'h264_qsv'):
        return requested
    if requested != 'auto':
        raise ValueError(f'Unsupported EV encoder: {requested}')
    # Probe the actual hardware, not just whether FFmpeg lists the encoder.
    try:
        result = subprocess.run([
            os.environ.get('FFMPEG_PATH', 'ffmpeg'), '-v', 'error', '-f', 'lavfi',
            '-i', 'color=size=320x240:rate=30', '-frames:v', '3',
            '-c:v', 'h264_qsv', '-f', 'null', '-',
        ], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
        if result.returncode == 0:
            return 'h264_qsv'
    except (OSError, subprocess.TimeoutExpired):
        pass
    return 'libx264'


def encoder_process_flags(background=False):
    # Resource limits already bound the encoder pool. Lower Windows priority
    # can starve exports for minutes while the browser is active.
    return getattr(subprocess, 'CREATE_NO_WINDOW', 0)


class EncodedFrameWriter:
    """Encode rendered frames once; the final audio step only remuxes video."""
    def __init__(self, path: Path, fps: float, width: int, height: int, encoder: str = 'libx264', background: bool = False):
        if encoder not in ('libx264', 'h264_qsv'):
            raise ValueError(f'Unsupported EV encoder: {encoder}')
        self.errors = tempfile.TemporaryFile()
        encoding = (['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '18']
                    if encoder == 'h264_qsv' else
                    ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18'])
        try:
            self.process = subprocess.Popen([
                os.environ.get('FFMPEG_PATH', 'ffmpeg'), '-y', '-v', 'error',
                '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{width}x{height}',
                '-r', f'{fps:.3f}', '-i', 'pipe:0', '-an', *encoding,
                '-threads', str(encoder_threads()), '-pix_fmt', 'yuv420p', str(path),
            ], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=self.errors, creationflags=encoder_process_flags(background))
        except Exception:
            self.errors.close()
            raise
        self.finished = False

    def __enter__(self):
        return self

    def write(self, frame: np.ndarray):
        self.process.stdin.write(memoryview(np.ascontiguousarray(frame)))

    def release(self):
        if self.finished:
            return
        self.process.stdin.close()
        code = self.process.wait(timeout=240)
        self.finished = True
        if code:
            self.errors.seek(0)
            raise RuntimeError(self.errors.read().decode('utf-8', errors='replace')[-4000:])

    def __exit__(self, exc_type, exc, tb):
        try:
            if exc_type is None:
                self.release()
        finally:
            if self.process.poll() is None:
                self.process.kill()
                self.process.wait()
            if self.process.stdin and not self.process.stdin.closed:
                self.process.stdin.close()
            self.errors.close()


def report_progress(message: str, progress: float) -> None:
    print(json.dumps({"message": message, "progress": max(0.0, min(1.0, progress))}), flush=True)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_lines(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in value.split("|") if part.strip()]


def humanize_label(value: object) -> str:
    text = str(value or "").replace("_", " ").strip()
    return " ".join(text.split())


def sentence_case(value: object) -> str:
    text = humanize_label(value)
    if not text:
        return ""
    return text[:1].upper() + text[1:]


def confidence_label(value: object) -> str:
    text = humanize_label(value).lower()
    if text in {"high", "medium", "low"}:
        return text
    if text in {"medium high", "medium-high"}:
        return "medium-high"
    return text or "working"


def percent_text(value: object) -> str | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    if number <= 1.0:
        number *= 100.0
    return f"{number:.0f}%"


def prediction_confidence_sentence(prediction: dict | None) -> str:
    """Explain the actual comparisons, without implying independently measured accuracy."""
    if not prediction:
        return "No prediction is available."
    if prediction.get('method') == 'distance_hang_constrained':
        return 'Uses your landing distance and time to first ground contact. Ball positions in the video have not verified the result.'
    shared = prediction.get("direction_first_match") or {}
    best = shared.get("best") or next(iter(prediction.get("ev_candidates") or []), {})
    if shared.get("acceptable") is False or (prediction.get("distance_review") or {}).get("required"):
        error = best.get("projected_path_rmse_px")
        detail = f" Average position difference: {float(error):.1f} px." if error is not None else ""
        return "The calculated path does not follow the ball positions you selected." + detail
    if not shared.get("acceptable"):
        return "The calculated path has not been checked against timed ball positions."
    count = int(shared.get("used_count") or 0)
    if count < 3:
        parts = [f"Only {count} ball position{'s' if count != 1 else ''} after contact {'were' if count != 1 else 'was'} used."]
    else:
        parts = [f"Compared with {count} ball positions after contact."]
    if shared.get('staged'):
        parts.append('Early marks constrain launch angle; later vertical positions constrain speed. Assumes a level camera with no zoom; sideways panning is allowed.')
    if shared.get("at_speed_boundary") or (shared.get("spray_refinement") or {}).get("at_search_boundary"):
        parts.append("The result is at the edge of the tested speeds or directions.")
    policy = shared.get("selection_policy") or {}
    distance = policy.get("target_distance_ft")
    if distance is not None and best.get("distance_ft") is not None:
        difference = abs(float(best['distance_ft']) - float(distance))
        parts.append("Calculated distance is within 1 ft of your entry." if difference < 1 else f"Calculated distance differs from your entry by {difference:.0f} ft.")
    timing = shared.get("hang_time_evidence") or {}
    if timing.get("landing_time_s") is not None and best.get("hang_time_s") is not None:
        difference = abs(float(best['hang_time_s']) - float(timing['landing_time_s']))
        parts.append("Calculated time in air is within 0.01 s of your video timing." if difference < .01 else f"Calculated time in air differs from your video timing by {difference:.2f} s.")
    return " ".join(parts)


def observation_points(package: dict) -> list[dict]:
    rows = []
    for row in package.get("ball_observations") or []:
        if row.get("image_x") is None or row.get("image_y") is None or row.get("relative_time_s") is None:
            continue
        rows.append(
            {
                "t": float(row["relative_time_s"]),
                "x": float(row["image_x"]),
                "y": float(row["image_y"]),
                "source": row.get("source") or "",
            }
        )
    return sorted(rows, key=lambda item: item["t"])


def best_prediction(prediction: dict | None) -> dict | None:
    if not prediction:
        return None
    rows = prediction.get("ev_candidates") or prediction.get("rows") or []
    return rows[0] if rows else None


def calculation_lines(package: dict, prediction: dict | None, fallback_lines: list[str]) -> list[str]:
    best = best_prediction(prediction)
    evidence = (prediction or {}).get("projected_path_evidence") or {}
    distance_evidence = evidence.get("distance_evidence") or {}
    description = humanize_label((package.get("hit") or {}).get("description") or (package.get("video_metadata") or {}).get("description"))
    lines = [description, "CLIP EXPORT"] if description else ["CLIP EXPORT"]
    if fallback_lines:
        _, fallback_stats = split_banner_stats(fallback_lines)
        lines.append("Displayed estimate: " + " | ".join(fallback_stats))
    elif best:
        ev = best.get("exit_velocity_mph")
        la = best.get("launch_angle_deg")
        dist = best.get("distance_ft")
        lines.append(f"Best synthetic match: {ev:.0f} mph EV / {la:.0f} deg LA / {dist:.0f} ft")
    else:
        lines.append("Best loaded estimate unavailable")

    if distance_evidence.get("distance_ft") is not None:
        source = humanize_label(distance_evidence.get("source") or "distance evidence")
        sigma = distance_evidence.get("uncertainty_ft")
        lines.append(f"Distance evidence: {distance_evidence['distance_ft']:.0f} ft from {source}; uncertainty +/- {sigma:.0f} ft")
    else:
        marker = (((package.get("hit") or {}).get("distance_observation") or {}).get("field_marker_percent") or {})
        if marker:
            lines.append("Endpoint marker supplies direction; distance was not resolved numerically")

    apex = (prediction or {}).get("apex_evidence") or ((package.get("hit") or {}).get("apex_observation") or {})
    if apex.get("relative_time_s") is not None:
        lines.append(f"Apex anchor: {float(apex['relative_time_s']):.0f}s after contact")
    else:
        lines.append("Apex anchor: not marked")

    reason = evidence.get("reason") or (prediction or {}).get("identifiability", {}).get("reason")
    if reason:
        lines.append(humanize_label(reason))
    return lines[:6]


def wrap_text(text: str, max_chars: int = 78) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current: list[str] = []
    for word in words:
        if len(" ".join([*current, word])) > max_chars and current:
            lines.append(" ".join(current))
            current = [word]
        else:
            current.append(word)
    if current:
        lines.append(" ".join(current))
    return lines


def description_lines(text: str, max_chars: int = 75, max_lines: int = 3) -> list[str]:
    lines: list[str] = []
    for raw_line in str(text or "").splitlines():
        wrapped = wrap_text(raw_line.strip(), max_chars=max_chars) if raw_line.strip() else [""]
        for line in wrapped:
            if len(lines) >= max_lines:
                break
            lines.append(line)
        if len(lines) >= max_lines:
            break
    return lines


def split_banner_stats(lines: list[str]) -> tuple[str, list[str]]:
    if not lines:
        return "", ["EV n/a", "Distance n/a", "LA n/a"]
    all_stats = [line for line in lines if line.upper().startswith(("EV ", "LA ", "DISTANCE ", "HANG "))]
    stats = [line for line in all_stats if not line.upper().startswith("HANG ")]
    stats.sort(key=lambda line: {"EV": 0, "DISTANCE": 1, "LA": 2}.get(line.split(" ", 1)[0].upper(), 9))
    description = " ".join(line for line in lines if line not in all_stats).strip()
    return description, stats[:3] or lines[:3]


def stat_values_from_lines(lines: list[str]) -> dict[str, str]:
    _, stats = split_banner_stats(lines)
    values: dict[str, str] = {}
    for stat in stats:
        if " " not in stat:
            continue
        label, value = stat.split(" ", 1)
        values[label.upper()] = value.strip()
    return values


def estimate_sentence(lines: list[str]) -> str:
    values = stat_values_from_lines(lines)
    ev = values.get("EV")
    distance = values.get("DISTANCE")
    launch = values.get("LA")
    if ev and launch and distance:
        return f"This swing is estimated at {ev} off the bat, {launch}, and {distance}."
    if ev and distance:
        return f"This swing is estimated at {ev} off the bat and {distance}."
    if distance and launch:
        return f"This swing is estimated to travel {distance} at {launch}."
    if ev:
        return f"This swing is estimated at {ev} off the bat."
    return "This swing estimate was built from the marked video path and field geometry."


def compact_stat_text(lines: list[str]) -> str:
    values = stat_values_from_lines(lines)
    parts = []
    if values.get("EV"):
        parts.append(values["EV"])
    if values.get("DISTANCE"):
        parts.append(values["DISTANCE"])
    if values.get("LA"):
        parts.append(values["LA"])
    return "   |   ".join(parts) if parts else "Estimate unavailable"


def draw_text_fit(
    canvas: np.ndarray,
    text: str,
    origin: tuple[int, int],
    max_width: int,
    base_scale: float,
    color: tuple[int, int, int],
    thickness: int = 2,
    min_scale: float = 0.45,
) -> float:
    scale = base_scale
    while scale > min_scale:
        (tw, _), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, thickness)
        if tw <= max_width:
            break
        scale -= 0.05
    cv2.putText(canvas, text, origin, cv2.FONT_HERSHEY_SIMPLEX, scale, color, thickness, cv2.LINE_AA)
    return scale


def draw_outlined_text(
    canvas: np.ndarray,
    text: str,
    origin: tuple[int, int],
    scale: float,
    color: tuple[int, int, int],
    outline: tuple[int, int, int] = (255, 255, 255),
    thickness: int = 2,
    outline_thickness: int = 5,
) -> None:
    cv2.putText(canvas, text, origin, cv2.FONT_HERSHEY_SIMPLEX, scale, outline, outline_thickness, cv2.LINE_AA)
    cv2.putText(canvas, text, origin, cv2.FONT_HERSHEY_SIMPLEX, scale, color, thickness, cv2.LINE_AA)


def draw_title_card(base_frame: np.ndarray, banner_lines: list[str], calc_lines: list[str]) -> np.ndarray:
    h, w = base_frame.shape[:2]
    canvas = cv2.GaussianBlur(base_frame, (0, 0), 10)
    shade = np.full_like(canvas, (4, 9, 11))
    cv2.addWeighted(shade, 0.62, canvas, 0.38, 0, canvas)
    cv2.rectangle(canvas, (0, 0), (w, h), (8, 18, 21), max(14, h // 80))

    description, stats = split_banner_stats(banner_lines)
    logo_w = min(int(w * 0.38), 420)
    top = max(36, h // 12)
    if VIDEO_LOGO is not None and logo_w > 40:
        scale = logo_w / VIDEO_LOGO.shape[1]
        logo_h = max(1, int(VIDEO_LOGO.shape[0] * scale))
        logo = cv2.resize(VIDEO_LOGO, (logo_w, logo_h), interpolation=cv2.INTER_AREA)
        overlay_rgba(canvas, logo, max(28, (w - logo_w) // 2), top)
        top += logo_h + 42

    title_lines = description_lines(description or "Hit Summary", max_chars=75, max_lines=3)
    title_scale = max(0.82, min(1.38, w / 900))
    for line in title_lines:
        (tw, _), _ = cv2.getTextSize(line, cv2.FONT_HERSHEY_SIMPLEX, title_scale, 3)
        cv2.putText(canvas, line, ((w - tw) // 2, top), cv2.FONT_HERSHEY_SIMPLEX, title_scale, (248, 252, 250), 3, cv2.LINE_AA)
        top += int(42 * title_scale) + 12
    top += 12

    summary = estimate_sentence(banner_lines)
    summary_lines = wrap_text(summary, max_chars=max(40, w // 18))[:2]
    summary_scale = max(0.82, min(1.18, w / 980))
    for line in summary_lines:
        (lw, _), _ = cv2.getTextSize(line, cv2.FONT_HERSHEY_SIMPLEX, summary_scale, 3)
        cv2.putText(canvas, line, ((w - lw) // 2, top), cv2.FONT_HERSHEY_SIMPLEX, summary_scale, (178, 219, 212), 3, cv2.LINE_AA)
        top += int(38 * summary_scale) + 12

    foot = "Calculated from the video frames and field information you selected."
    y = min(h - 72, top + 36)
    for line in wrap_text(foot, max_chars=max(48, w // 17))[:2]:
        (lw, _), _ = cv2.getTextSize(line, cv2.FONT_HERSHEY_SIMPLEX, 0.68, 1)
        cv2.putText(canvas, line, ((w - lw) // 2, y), cv2.FONT_HERSHEY_SIMPLEX, 0.68, (208, 224, 228), 1, cv2.LINE_AA)
        y += 28
    return canvas


def draw_end_card(base_frame: np.ndarray, banner_lines: list[str], calc_lines: list[str], prediction: dict | None = None) -> np.ndarray:
    h, w = base_frame.shape[:2]
    canvas = cv2.GaussianBlur(base_frame, (0, 0), 8)
    shade = np.full_like(canvas, (5, 10, 12))
    cv2.addWeighted(shade, 0.72, canvas, 0.28, 0, canvas)

    description, stats = split_banner_stats(banner_lines)
    if VIDEO_LOGO is not None:
        logo_w = min(int(w * 0.24), 300)
        scale = logo_w / VIDEO_LOGO.shape[1]
        logo_h = max(1, int(VIDEO_LOGO.shape[0] * scale))
        logo = cv2.resize(VIDEO_LOGO, (logo_w, logo_h), interpolation=cv2.INTER_AREA)
        overlay_rgba(canvas, logo, 34, 30)

    margin = max(16, min(34, w // 25))
    top = 30 + (logo_h if VIDEO_LOGO is not None else 0) + 24
    sections = []
    if description:
        sections.append((description, 0.9, (248, 252, 250), 2))
    labels = {'EV': 'EXIT VELOCITY', 'DISTANCE': 'DISTANCE', 'LAUNCH': 'LAUNCH ANGLE'}
    for label, value in focus_stats_from_lines(banner_lines):
        if value != 'n/a':
            sections.append((labels[label], 0.65, (178, 219, 212), 2))
            sections.append((value, 1.9, (248, 252, 250), 3))
    sections.append(('Video estimate', 0.58, (205, 221, 225), 1))
    # Measure actual pixels and fit every line, rather than silently slicing sentences.
    factor = min(1.0, w / 1280)
    while True:
        layout = []
        y = top
        for text, size, color, weight in sections:
            size *= factor
            weight = max(1, round(weight * factor))
            lines = []
            line = ''
            for word in text.split():
                candidate = f'{line} {word}'.strip()
                if line and cv2.getTextSize(candidate, cv2.FONT_HERSHEY_SIMPLEX, size, weight)[0][0] > w - 2 * margin:
                    lines.append(line)
                    line = ''
                for char in word:
                    candidate = line + char
                    if line and cv2.getTextSize(candidate, cv2.FONT_HERSHEY_SIMPLEX, size, weight)[0][0] > w - 2 * margin:
                        lines.append(line)
                        line = ''
                    line += char
                line += ' '
            if line.strip():
                lines.append(line.strip())
            for line in lines:
                (_, height), baseline = cv2.getTextSize(line, cv2.FONT_HERSHEY_SIMPLEX, size, weight)
                y += height
                layout.append((line, (margin, y), size, color, weight))
                y += baseline + max(5, round(8 * factor))
            y += max(8, round(18 * factor))
        if y <= h - margin:
            break
        factor *= 0.9
        if factor < 0.05:
            raise ValueError('Closing screen is too small for the estimate text.')
    for line, origin, size, color, weight in layout:
        cv2.putText(canvas, line, origin, cv2.FONT_HERSHEY_SIMPLEX, size, color, weight, cv2.LINE_AA)
    return canvas


def focus_stats_from_lines(lines: list[str]) -> list[tuple[str, str]]:
    _, stats = split_banner_stats(lines)
    parsed: dict[str, str] = {}
    for stat in stats:
        if " " not in stat:
            continue
        label, value = stat.split(" ", 1)
        parsed[label.upper()] = value
    ordered = [
        ("EV", parsed.get("EV", "n/a")),
        ("DISTANCE", parsed.get("DISTANCE", "n/a")),
        ("LAUNCH", parsed.get("LA", "n/a")),
    ]
    return ordered


def draw_focus_stat_card(base_frame: np.ndarray, label: str, value: str, index: int, total: int) -> np.ndarray:
    h, w = base_frame.shape[:2]
    canvas = cv2.GaussianBlur(base_frame, (0, 0), 9)
    shade = np.full_like(canvas, (5, 12, 15))
    cv2.addWeighted(shade, 0.70, canvas, 0.30, 0, canvas)
    cv2.rectangle(canvas, (0, 0), (w, h), (8, 18, 21), max(12, h // 96))

    title = label.replace("DISTANCE", "DISTANCE").replace("LAUNCH", "LAUNCH ANGLE")
    title_scale = max(0.86, min(1.25, w / 980))
    value_scale = max(2.25, min(4.6, w / 280))
    (tw, _), _ = cv2.getTextSize(title, cv2.FONT_HERSHEY_SIMPLEX, title_scale, 3)
    cv2.putText(canvas, title, ((w - tw) // 2, int(h * 0.30)), cv2.FONT_HERSHEY_SIMPLEX, title_scale, (178, 219, 212), 3, cv2.LINE_AA)
    fitted_scale = value_scale
    while fitted_scale > 1.45:
        (vw, _), _ = cv2.getTextSize(value, cv2.FONT_HERSHEY_SIMPLEX, fitted_scale, 8)
        if vw <= int(w * 0.84):
            break
        fitted_scale -= 0.08
    (vw, _), _ = cv2.getTextSize(value, cv2.FONT_HERSHEY_SIMPLEX, fitted_scale, 8)
    cv2.putText(canvas, value, ((w - vw) // 2, int(h * 0.58)), cv2.FONT_HERSHEY_SIMPLEX, fitted_scale, (248, 252, 250), 8, cv2.LINE_AA)

    dot_y = int(h * 0.78)
    spacing = 34
    start_x = w // 2 - spacing * (total - 1) // 2
    for dot in range(total):
        color = (123, 219, 189) if dot == index else (70, 90, 96)
        cv2.circle(canvas, (start_x + dot * spacing, dot_y), 7, color, -1, cv2.LINE_AA)
    return canvas


def overlay_rgba(base: np.ndarray, rgba: np.ndarray, x: int, y: int) -> None:
    if rgba is None or rgba.size == 0:
        return
    h, w = rgba.shape[:2]
    if x >= base.shape[1] or y >= base.shape[0]:
        return
    crop_w = min(w, base.shape[1] - x)
    crop_h = min(h, base.shape[0] - y)
    if crop_w <= 0 or crop_h <= 0:
        return
    logo = rgba[:crop_h, :crop_w]
    if logo.shape[2] == 4:
        alpha = logo[:, :, 3:4].astype(np.float32) / 255.0
        base_region = base[y : y + crop_h, x : x + crop_w].astype(np.float32)
        color = logo[:, :, :3].astype(np.float32)
        base[y : y + crop_h, x : x + crop_w] = (color * alpha + base_region * (1.0 - alpha)).astype(np.uint8)
    else:
        base[y : y + crop_h, x : x + crop_w] = logo[:crop_h, :crop_w, :3]


def draw_banner(frame: np.ndarray, banner_h: int, lines: list[str], mode: str = "normal") -> np.ndarray:
    h, w = frame.shape[:2]
    canvas = frame.copy()
    x0 = max(14, w // 70)
    y0 = max(12, h // 60)
    x1 = w - x0
    description, stats = split_banner_stats(lines)

    content_w = max(220, x1 - x0 - 40)
    heading = description or "GameFrame"
    heading_lines = description_lines(heading, max_chars=54, max_lines=1)
    line_scale = max(0.62, min(0.88, w / 1400))
    line_step = max(28, int(line_scale * 38))
    stat_line = compact_stat_text(lines)
    logo_h_estimate = 0
    if VIDEO_LOGO is not None:
        logo_w_estimate = min(150, max(80, int(content_w * 0.15)))
        logo_h_estimate = int(VIDEO_LOGO.shape[0] * (logo_w_estimate / VIDEO_LOGO.shape[1]))
    text_block_h = len(heading_lines) * line_step
    stat_line_h = max(34, int(line_scale * 46))
    overlay_h = max(104, logo_h_estimate + 24, text_block_h + stat_line_h + 34)
    overlay_h = min(overlay_h, max(132, int(h * 0.22)))
    y1 = min(h - y0, y0 + overlay_h)
    overlay_h = y1 - y0
    banner = canvas[y0:y1, x0:x1].copy()
    color = np.full_like(banner, (18, 24, 28) if mode == "normal" else (10, 16, 20))
    cv2.addWeighted(color, 0.50, banner, 0.50, 0, banner)
    canvas[y0:y1, x0:x1] = banner
    cv2.rectangle(canvas, (x0, y0), (x1, y1), (123, 219, 189), 2, cv2.LINE_AA)
    cv2.line(canvas, (x0 + 2, y1 - 3), (x1 - 2, y1 - 3), (39, 116, 105), 2, cv2.LINE_AA)

    left = x0 + 20
    text_left = left
    if VIDEO_LOGO is not None:
        max_logo_w = min(150, max(80, int((x1 - x0) * 0.15)))
        logo_scale = max_logo_w / VIDEO_LOGO.shape[1]
        logo_w = int(VIDEO_LOGO.shape[1] * logo_scale)
        logo_h = int(VIDEO_LOGO.shape[0] * logo_scale)
        if logo_h > max(28, (y1 - y0) - 24):
            logo_scale *= max(28, (y1 - y0) - 24) / logo_h
            logo_w = int(VIDEO_LOGO.shape[1] * logo_scale)
            logo_h = int(VIDEO_LOGO.shape[0] * logo_scale)
        resized_logo = cv2.resize(VIDEO_LOGO, (logo_w, logo_h), interpolation=cv2.INTER_AREA)
        logo_y = y0 + max(10, ((y1 - y0) - logo_h) // 2)
        overlay_rgba(canvas, resized_logo, left, logo_y)
        text_left = left + logo_w + 20

    text_area_w = max(180, x1 - text_left - 20)
    first_y = y0 + 34
    for line_idx, line in enumerate(heading_lines):
        draw_text_fit(canvas, line, (text_left, first_y + line_idx * line_step), text_area_w, line_scale, (248, 252, 250), 2, min_scale=0.38)
    stats_y = first_y + len(heading_lines) * line_step + 8

    draw_text_fit(canvas, stat_line, (text_left, min(y1 - 18, stats_y + 24)), text_area_w, 0.92, (178, 219, 212), 3, min_scale=0.52)
    return canvas


def draw_path(frame: np.ndarray, rows: list[dict], relative_time: float, full_path: bool = False) -> None:
    visible = [row for row in rows if full_path or row["t"] <= relative_time + 1e-6]
    if not visible:
        return
    pts = [(int(round(row["x"])), int(round(row["y"]))) for row in visible]
    if len(pts) > 1:
        cv2.polylines(frame, [np.array(pts, dtype=np.int32)], False, (255, 255, 255), 5, cv2.LINE_AA)
        cv2.polylines(frame, [np.array(pts, dtype=np.int32)], False, (40, 80, 255), 2, cv2.LINE_AA)
    for idx, (x, y) in enumerate(pts):
        color = (80, 220, 255) if idx == len(pts) - 1 else (245, 245, 245)
        cv2.circle(frame, (x, y), 10, color, 2, cv2.LINE_AA)
        cv2.circle(frame, (x, y), 3, (40, 80, 255), -1, cv2.LINE_AA)
    if pts:
        x, y = pts[-1]
        cv2.putText(frame, "ball path", (x + 14, y - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2, cv2.LINE_AA)


def trajectory_points(prediction: dict | None) -> list[dict]:
    rows = [] if not prediction else prediction.get("best_trajectory_points") or []
    clean = []
    for row in rows:
        try:
            clean.append({
                "t": float(row.get("relative_time_s", row.get("t", 0.0))),
                "x": float(row["x_ft"]),
                "y": float(row["y_ft"]),
                "z": float(row["z_ft"]),
            })
        except Exception:
            continue
    return sorted(clean, key=lambda row: row["t"])


def best_prediction_row(prediction: dict | None) -> dict:
    if not prediction:
        return {}
    rows = prediction.get("ev_candidates") or (prediction.get("unconstrained") or {}).get("top") or []
    return rows[0] if rows else {}


def synthetic_flight_points(prediction: dict | None) -> list[dict]:
    if (prediction or {}).get("method") in ("joint_calibrated_pixels_and_supplied_landing_distance", "direction_first_shared_synthetic_match", "distance_hang_constrained"):
        return trajectory_points(prediction)
    best = best_prediction_row(prediction)
    if not best:
        return []
    try:
        distance_ft = float(best.get("distance_ft"))
        hang_time_s = float(best.get("hang_time_s"))
    except Exception:
        return []
    if not math.isfinite(distance_ft) or not math.isfinite(hang_time_s) or hang_time_s <= 0:
        return []
    try:
        apex_ft = float(best.get("apex_ft"))
    except Exception:
        apex_ft = 30.0
    try:
        apex_time_s = float(best.get("apex_time_s"))
    except Exception:
        apex_time_s = float("nan")
    field_direction = (prediction or {}).get("field_direction") or {}
    try:
        spray_deg = float(best.get("spray_angle_deg", field_direction.get("spray_angle_deg", 0.0)))
    except Exception:
        spray_deg = 0.0
    spray_rad = math.radians(spray_deg)
    start_height_ft = 2.5
    samples: list[dict] = []
    for i in range(73):
        t = hang_time_s * i / 72.0
        u = t / hang_time_s
        downrange = distance_ft * u
        if math.isfinite(apex_ft) and math.isfinite(apex_time_s) and 0 < apex_time_s < hang_time_s:
            if t <= apex_time_s:
                a = t / apex_time_s
                height = start_height_ft + (apex_ft - start_height_ft) * (2 * a - a * a)
            else:
                a = (t - apex_time_s) / (hang_time_s - apex_time_s)
                height = apex_ft * (1 - a * a)
        else:
            height = max(0.0, 4.0 * (apex_ft if math.isfinite(apex_ft) else 30.0) * u * (1 - u))
        samples.append({
            "t": t,
            "x": math.sin(spray_rad) * downrange,
            "y": math.cos(spray_rad) * downrange,
            "z": max(0.0, height),
        })
    return samples


FIELD_PROFILES = {
    "43_60_softball": {"label": "43/60 softball", "base_ft": 60.0, "fence_ft": 200.0, "rings": [100, 150, 175, 200], "guide_ft": 225.0},
    "45_60": {"label": "45/60", "base_ft": 60.0, "fence_ft": 225.0, "rings": [100, 150, 200, 225], "guide_ft": 250.0},
    "50_70": {"label": "50/70", "base_ft": 70.0, "fence_ft": 250.0, "rings": [150, 200, 225, 250], "guide_ft": 280.0},
    "60_90": {"label": "60/90", "base_ft": 90.0, "fence_ft": 400.0, "rings": [250, 300, 350, 400], "guide_ft": 430.0},
}


def field_profile(package: dict | None) -> dict:
    metadata = (package or {}).get("video_metadata") or {}
    key = (
        ((package or {}).get("field") or {}).get("key")
        or ((package or {}).get("field_size") or {}).get("key")
        or metadata.get("field_size_key")
        or metadata.get("field_key")
        or "60_90"
    )
    return FIELD_PROFILES.get(str(key), FIELD_PROFILES["60_90"])


def field_marker_world(marker: dict | None, profile: dict) -> np.ndarray | None:
    if not marker:
        return None
    try:
        marker_x = float(marker.get("x", 50.0)) * 3.6
        marker_y = float(marker.get("y", 50.0)) * 4.2
    except Exception:
        return None
    scale_ft_per_svg_unit = float(profile["fence_ft"]) / 234.0
    return np.array([(marker_x - 180.0) * scale_ft_per_svg_unit, (316.0 - marker_y) * scale_ft_per_svg_unit, 0.0], dtype=float)


def actual_field_map_geometry(package: dict | None) -> dict | None:
    distance_observation = (((package or {}).get("hit") or {}).get("distance_observation") or {})
    geometry = distance_observation.get("actual_field_map") or (((package or {}).get("camera") or {}).get("actual_field_map") or {})
    if not isinstance(geometry, dict) or geometry.get("source") != "actual_field_map":
        return None
    required = ("camera_xy_ft", "landing_xy_ft")
    if any(not isinstance(geometry.get(key), dict) for key in required):
        return None
    return geometry


def xy_from_geometry(point: dict | None) -> np.ndarray | None:
    if not isinstance(point, dict):
        return None
    try:
        x = float(point["x"])
        y = float(point["y"])
    except Exception:
        return None
    if not math.isfinite(x) or not math.isfinite(y):
        return None
    return np.array([x, y], dtype=float)


def image_from_data_url(value: str | None) -> np.ndarray | None:
    if not value or "," not in value:
        return None
    try:
        _, encoded = value.split(",", 1)
        data = base64.b64decode(encoded)
        array = np.frombuffer(data, dtype=np.uint8)
        image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    except Exception:
        return None
    return image if image is not None and image.size else None


def point_label(point: np.ndarray, label: str) -> str:
    return f"{label} ({point[0]:.0f}, {point[1]:.0f} ft)"


def signed_angle_label(angle: float | None) -> str:
    if angle is None or not math.isfinite(angle):
        return "direction n/a"
    side = "left" if angle < -0.5 else "right" if angle > 0.5 else "center"
    return f"{abs(angle):.0f} deg {side}"


def draw_dashed_line(canvas: np.ndarray, a: tuple[int, int], b: tuple[int, int], color: tuple[int, int, int], thickness: int = 2, dash_px: int = 16, gap_px: int = 10) -> None:
    ax, ay = a
    bx, by = b
    length = math.hypot(bx - ax, by - ay)
    if length <= 1:
        return
    steps = max(1, int(length // (dash_px + gap_px)))
    vx = (bx - ax) / length
    vy = (by - ay) / length
    pos = 0.0
    while pos < length:
        end = min(length, pos + dash_px)
        p1 = (int(round(ax + vx * pos)), int(round(ay + vy * pos)))
        p2 = (int(round(ax + vx * end)), int(round(ay + vy * end)))
        cv2.line(canvas, p1, p2, color, thickness, cv2.LINE_AA)
        pos += dash_px + gap_px


def draw_evidence_marker(canvas: np.ndarray, point: tuple[int, int], label: str, color: tuple[int, int, int], label_side: int = 1) -> None:
    x, y = point
    cv2.circle(canvas, (x, y), 8, (255, 255, 255), -1, cv2.LINE_AA)
    cv2.circle(canvas, (x, y), 8, color, 3, cv2.LINE_AA)
    cv2.circle(canvas, (x, y), 3, color, -1, cv2.LINE_AA)
    label_x = x + 14 * label_side
    label_y = y - 10
    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.52, 1)
    if label_side < 0:
        label_x = x - tw - 14
    cv2.rectangle(canvas, (label_x - 6, label_y - th - 8), (label_x + tw + 6, label_y + 7), (238, 244, 242), -1, cv2.LINE_AA)
    cv2.putText(canvas, label, (label_x, label_y), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (33, 49, 53), 1, cv2.LINE_AA)


def draw_actual_map_evidence_frame(width: int, height: int, package: dict | None, prediction: dict | None) -> np.ndarray:
    canvas = np.full((height, width, 3), (240, 243, 241), dtype=np.uint8)
    cv2.rectangle(canvas, (0, 0), (width, height), (222, 229, 226), -1)
    cv2.rectangle(canvas, (0, 0), (width, 104), (26, 34, 39), -1)
    if VIDEO_LOGO is not None:
        logo_w = min(260, max(150, width // 5))
        logo_scale = logo_w / VIDEO_LOGO.shape[1]
        logo_h = int(VIDEO_LOGO.shape[0] * logo_scale)
        logo = cv2.resize(VIDEO_LOGO, (logo_w, logo_h), interpolation=cv2.INTER_AREA)
        overlay_rgba(canvas, logo, 28, max(22, (104 - logo_h) // 2))
        text_x = 28 + logo_w + 28
    else:
        text_x = 34
        cv2.putText(canvas, "GAMEFRAME", (text_x, 58), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (248, 252, 250), 3, cv2.LINE_AA)
        text_x += 250
    cv2.putText(canvas, "Actual Field Map Evidence", (text_x, 48), cv2.FONT_HERSHEY_SIMPLEX, 1.08, (248, 252, 250), 3, cv2.LINE_AA)
    cv2.putText(canvas, "Distance and direction from the marked map points", (text_x, 84), cv2.FONT_HERSHEY_SIMPLEX, 0.68, (190, 207, 211), 2, cv2.LINE_AA)

    geometry = actual_field_map_geometry(package)
    if geometry is None:
        cv2.putText(canvas, "Actual field map markings were not saved for this export.", (40, height // 2), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (35, 52, 58), 2, cv2.LINE_AA)
        return canvas

    home = np.array([0.0, 0.0], dtype=float)
    camera = xy_from_geometry(geometry.get("camera_xy_ft"))
    if camera is None:
        camera = np.array([0.0, -70.0], dtype=float)
    landing = xy_from_geometry(geometry.get("landing_xy_ft"))
    if landing is None:
        landing = np.array([0.0, 300.0], dtype=float)
    try:
        base_ft = float(field_profile(package)["base_ft"])
    except Exception:
        base_ft = 90.0
    try:
        axis_distance = float(geometry.get("axis_distance_ft") or (base_ft * math.sqrt(2)))
    except Exception:
        axis_distance = base_ft * math.sqrt(2)
    axis = np.array([0.0, axis_distance], dtype=float)
    best = best_prediction_row(prediction)
    distance = float(geometry.get("landing_distance_ft") or np.linalg.norm(landing))
    direction = float(geometry.get("landing_angle_deg")) if geometry.get("landing_angle_deg") is not None else math.degrees(math.atan2(float(landing[0]), float(landing[1])))
    camera_distance = float(geometry.get("camera_distance_ft") or np.linalg.norm(camera))
    camera_angle = float(geometry.get("camera_angle_deg")) if geometry.get("camera_angle_deg") is not None else math.degrees(math.atan2(float(camera[0]), float(camera[1])))
    info_lines = [
        ("Landing distance", f"{distance:.0f} ft"),
        ("Landing direction", signed_angle_label(direction)),
        ("Camera position", f"{camera_distance:.0f} ft from home, {signed_angle_label(camera_angle)}"),
        ("Field axis", "marked with second base or rubber"),
    ]
    if best:
        info_lines.extend([
            ("Matched estimate", f"{best.get('exit_velocity_mph', 0):.0f} mph / {best.get('launch_angle_deg', 0):.0f} deg"),
            ("Synthetic distance", f"{best.get('distance_ft', 0):.0f} ft"),
        ])

    screenshot = image_from_data_url(geometry.get("evidence_image_data_url"))
    if screenshot is not None:
        left_x = max(26, width // 32)
        left_y = 132
        left_w = int(width * 0.62)
        left_h = height - left_y - 42
        shot_h, shot_w = screenshot.shape[:2]
        scale = min(left_w / max(1, shot_w), left_h / max(1, shot_h))
        draw_w = max(2, int(round(shot_w * scale)))
        draw_h = max(2, int(round(shot_h * scale)))
        draw_x = left_x + (left_w - draw_w) // 2
        draw_y = left_y + (left_h - draw_h) // 2
        cv2.rectangle(canvas, (left_x - 12, left_y - 12), (left_x + left_w + 12, left_y + left_h + 12), (248, 250, 249), -1, cv2.LINE_AA)
        cv2.rectangle(canvas, (left_x - 12, left_y - 12), (left_x + left_w + 12, left_y + left_h + 12), (205, 216, 214), 1, cv2.LINE_AA)
        resized = cv2.resize(screenshot, (draw_w, draw_h), interpolation=cv2.INTER_AREA)
        canvas[draw_y:draw_y + draw_h, draw_x:draw_x + draw_w] = resized
        cv2.rectangle(canvas, (draw_x, draw_y), (draw_x + draw_w, draw_y + draw_h), (22, 34, 38), 2, cv2.LINE_AA)
        cv2.putText(canvas, "Saved satellite map view with user marks", (left_x, min(height - 20, left_y + left_h + 34)), cv2.FONT_HERSHEY_SIMPLEX, 0.72, (75, 91, 96), 2, cv2.LINE_AA)

        info_x = left_x + left_w + 34
        card_w = max(260, width - info_x - 34)
        cv2.putText(canvas, "Evidence used in estimate", (info_x, left_y + 14), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (28, 44, 49), 3, cv2.LINE_AA)
        y = left_y + 62
        for label, value in info_lines:
            cv2.putText(canvas, label.upper(), (info_x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.58, (100, 117, 122), 2, cv2.LINE_AA)
            draw_text_fit(canvas, value, (info_x, y + 28), card_w, 0.84, (23, 38, 43), 3, min_scale=0.52)
            y += 58
        note = "The export includes this marked map view so viewers can audit the distance, direction, camera location, and field axis used by the estimate."
        y = min(height - 56, y + 12)
        for line in wrap_text(note, max_chars=max(32, card_w // 13))[:2]:
            cv2.putText(canvas, line, (info_x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (86, 103, 108), 2, cv2.LINE_AA)
            y += 30
        return canvas

    points = [home, camera, landing, axis]
    min_xy = np.min(np.vstack(points), axis=0)
    max_xy = np.max(np.vstack(points), axis=0)
    span = np.maximum(max_xy - min_xy, np.array([60.0, 60.0]))
    pad = span * 0.18 + 35.0
    min_xy -= pad
    max_xy += pad
    plot_x0 = max(26, width // 30)
    plot_y0 = 132
    plot_w = int(width * 0.62)
    plot_h = height - plot_y0 - 40
    info_x = plot_x0 + plot_w + 34
    scale = min(plot_w / max(1.0, max_xy[0] - min_xy[0]), plot_h / max(1.0, max_xy[1] - min_xy[1]))

    def project(point: np.ndarray) -> tuple[int, int]:
        x = plot_x0 + int(round((point[0] - min_xy[0]) * scale))
        y = plot_y0 + plot_h - int(round((point[1] - min_xy[1]) * scale))
        return x, y

    cv2.rectangle(canvas, (plot_x0 - 12, plot_y0 - 12), (plot_x0 + plot_w + 12, plot_y0 + plot_h + 12), (248, 250, 249), -1, cv2.LINE_AA)
    cv2.rectangle(canvas, (plot_x0 - 12, plot_y0 - 12), (plot_x0 + plot_w + 12, plot_y0 + plot_h + 12), (205, 216, 214), 1, cv2.LINE_AA)
    cv2.rectangle(canvas, (plot_x0, plot_y0), (plot_x0 + plot_w, plot_y0 + plot_h), (211, 229, 218), -1)

    home_p = project(home)
    camera_p = project(camera)
    axis_p = project(axis)
    landing_p = project(landing)
    max_ring = max(100.0, float(geometry.get("landing_distance_ft") or np.linalg.norm(landing)) * 1.05)
    ring_step = 50.0 if max_ring <= 260 else 100.0
    radius = ring_step
    while radius <= max_ring + 1:
        arc_points = []
        for deg in range(-55, 56, 2):
            rad = math.radians(deg)
            arc_points.append(project(np.array([math.sin(rad) * radius, math.cos(rad) * radius], dtype=float)))
        cv2.polylines(canvas, [np.array(arc_points, dtype=np.int32)], False, (127, 178, 168), 1, cv2.LINE_AA)
        label = project(np.array([-0.18 * radius, math.cos(math.radians(10)) * radius], dtype=float))
        draw_outlined_text(canvas, f"{radius:.0f} ft", (label[0] - 18, label[1]), 0.78, (52, 70, 75), (235, 243, 239), 2, 6)
        radius += ring_step

    left_line = project(np.array([math.sin(math.radians(-45)) * max_ring, math.cos(math.radians(-45)) * max_ring], dtype=float))
    right_line = project(np.array([math.sin(math.radians(45)) * max_ring, math.cos(math.radians(45)) * max_ring], dtype=float))
    cv2.line(canvas, home_p, left_line, (248, 250, 249), 3, cv2.LINE_AA)
    cv2.line(canvas, home_p, right_line, (248, 250, 249), 3, cv2.LINE_AA)
    draw_dashed_line(canvas, home_p, camera_p, (45, 105, 180), 2)
    draw_dashed_line(canvas, home_p, axis_p, (38, 118, 104), 2)
    cv2.line(canvas, home_p, landing_p, (35, 46, 53), 3, cv2.LINE_AA)
    cv2.line(canvas, camera_p, landing_p, (89, 104, 111), 1, cv2.LINE_AA)

    draw_evidence_marker(canvas, home_p, "Home", (240, 190, 54), -1)
    draw_evidence_marker(canvas, camera_p, "Camera", (36, 126, 220), 1)
    draw_evidence_marker(canvas, axis_p, "2B/Rubber", (31, 124, 109), 1)
    draw_evidence_marker(canvas, landing_p, "Landing", (213, 71, 62), 1 if landing[0] < 0 else -1)

    cv2.putText(canvas, "Evidence used in estimate", (info_x, plot_y0 + 14), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (28, 44, 49), 3, cv2.LINE_AA)
    y = plot_y0 + 62
    card_w = max(260, width - info_x - 34)
    for label, value in info_lines:
        cv2.putText(canvas, label.upper(), (info_x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.58, (100, 117, 122), 2, cv2.LINE_AA)
        draw_text_fit(canvas, value, (info_x, y + 28), card_w, 0.84, (23, 38, 43), 3, min_scale=0.52)
        y += 58

    note = "These marks are shown so viewers can see the map-based distance, camera location, and field direction behind the estimate."
    y = min(height - 56, y + 12)
    for line in wrap_text(note, max_chars=max(32, card_w // 13))[:2]:
        cv2.putText(canvas, line, (info_x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (86, 103, 108), 2, cv2.LINE_AA)
        y += 30
    return canvas


def camera_view_angles(package: dict | None, rows: list[dict], profile: dict) -> tuple[float, float]:
    camera_marker = (((package or {}).get("camera") or {}).get("field_marker_percent") or {})
    landing_marker = ((((package or {}).get("hit") or {}).get("distance_observation") or {}).get("field_marker_percent") or {})
    camera = field_marker_world(camera_marker, profile)
    if camera is None:
        camera = np.array([0.0, -125.0, 0.0], dtype=float)
    if rows:
        target_row = rows[min(len(rows) - 1, max(0, int(round(len(rows) * 0.42))))]
        target = np.array([target_row["x"], target_row["y"], 0.0], dtype=float)
    else:
        target = field_marker_world(landing_marker, profile)
        if target is None:
            target = np.array([0.0, float(profile["fence_ft"]) * 0.55, 0.0], dtype=float)
    dx = float(target[0] - camera[0])
    dy = float(target[1] - camera[1])
    yaw = math.atan2(dx, dy) if abs(dx) + abs(dy) > 1e-6 else 0.0
    try:
        camera_height = float(((package or {}).get("camera") or {}).get("height_ft") or 6.0)
    except Exception:
        camera_height = 6.0
    pitch = max(0.38, min(0.92, 0.5 + camera_height / 120.0))
    return yaw, pitch


def rotate_project(point: np.ndarray, center: np.ndarray, yaw: float, pitch: float, scale: float, ox: float, oy: float) -> tuple[int, int]:
    shifted = point - center
    cos_y, sin_y = math.cos(yaw), math.sin(yaw)
    cos_p, sin_p = math.cos(pitch), math.sin(pitch)
    x1 = shifted[0] * cos_y - shifted[1] * sin_y
    y1 = shifted[0] * sin_y + shifted[1] * cos_y
    screen_y = -(shifted[2] * cos_p - y1 * sin_p)
    return int(round(ox + x1 * scale)), int(round(oy + screen_y * scale))


def draw_projected_polyline(canvas: np.ndarray, points: list[np.ndarray], center: np.ndarray, yaw: float, pitch: float, scale: float, ox: float, oy: float, color: tuple[int, int, int], thickness: int, closed: bool = False) -> None:
    if len(points) < 2:
        return
    pts = np.array([rotate_project(point, center, yaw, pitch, scale, ox, oy) for point in points], dtype=np.int32)
    cv2.polylines(canvas, [pts], closed, color, thickness, cv2.LINE_AA)


def radial_points(radius_ft: float, start_deg: float = -45.0, end_deg: float = 45.0, step_deg: float = 2.5) -> list[dict]:
    points = []
    deg = start_deg
    while deg <= end_deg + 0.001:
        rad = math.radians(deg)
        points.append({"x": math.sin(rad) * radius_ft, "y": math.cos(rad) * radius_ft, "z": 0.0})
        deg += step_deg
    return points


def base_diamond_points(profile: dict) -> list[dict]:
    base = float(profile["base_ft"])
    offset = base / math.sqrt(2)
    return [
        {"x": 0.0, "y": 0.0, "z": 0.0},
        {"x": offset, "y": offset, "z": 0.0},
        {"x": 0.0, "y": base * math.sqrt(2), "z": 0.0},
        {"x": -offset, "y": offset, "z": 0.0},
        {"x": 0.0, "y": 0.0, "z": 0.0},
    ]


def project_app_point(point: dict, yaw: float, pitch: float, roll: float, scale: float, origin_x: float, origin_y: float) -> dict:
    cos_yaw = math.cos(yaw)
    sin_yaw = math.sin(yaw)
    cos_pitch = math.cos(pitch)
    sin_pitch = math.sin(pitch)
    cos_roll = math.cos(roll)
    sin_roll = math.sin(roll)
    xr = float(point["x"]) * cos_yaw - float(point["y"]) * sin_yaw
    yr = float(point["x"]) * sin_yaw + float(point["y"]) * cos_yaw
    zr = float(point.get("z") or 0.0)
    view_x = xr
    view_y = yr * sin_pitch + zr * cos_pitch
    depth = yr * cos_pitch - zr * sin_pitch
    rolled_x = view_x * cos_roll - view_y * sin_roll
    rolled_y = view_x * sin_roll + view_y * cos_roll
    perspective = 1.0 / max(0.42, 1.0 + depth / 900.0)
    return {
        "x": origin_x + rolled_x * scale * perspective,
        "y": origin_y - rolled_y * scale * perspective,
        "depth": depth,
        "perspective": perspective,
    }


def fit_app_projection(groups: list[list[dict]], width: int, height: int, yaw: float, pitch: float, roll: float) -> dict:
    projected = [project_app_point(point, yaw, pitch, roll, 1.0, 0.0, 0.0) for group in groups for point in group]
    min_x = min(point["x"] for point in projected)
    max_x = max(point["x"] for point in projected)
    min_y = min(point["y"] for point in projected)
    max_y = max(point["y"] for point in projected)
    world_width = max(1.0, max_x - min_x)
    world_height = max(1.0, max_y - min_y)
    scale = min((width - 54.0) / world_width, (height - 104.0) / world_height)
    return {
        "scale": scale,
        "origin_x": width / 2.0 - ((min_x + max_x) / 2.0) * scale,
        "origin_y": height / 2.0 + 16.0 - ((min_y + max_y) / 2.0) * scale,
    }


def draw_app_path(canvas: np.ndarray, points: list[dict], project, color: tuple[int, int, int], thickness: int, dash: tuple[int, int] | None = None) -> None:
    if len(points) < 2:
        return
    projected = [project(point) for point in points]
    pts = np.array([(int(round(point["x"])), int(round(point["y"]))) for point in projected], dtype=np.int32)
    if dash:
        for idx in range(len(pts) - 1):
            if idx % 2 == 0:
                cv2.line(canvas, tuple(pts[idx]), tuple(pts[idx + 1]), color, thickness, cv2.LINE_AA)
    else:
        cv2.polylines(canvas, [pts], False, color, thickness, cv2.LINE_AA)


def interpolate_app_point(samples: list[dict], time01: float) -> dict:
    if time01 <= 0:
        return samples[0]
    if time01 >= 1:
        return samples[-1]
    scaled = time01 * (len(samples) - 1)
    index = int(math.floor(scaled))
    mix = scaled - index
    a = samples[index]
    b = samples[min(len(samples) - 1, index + 1)]
    return {
        "t": a["t"] + (b["t"] - a["t"]) * mix,
        "x": a["x"] + (b["x"] - a["x"]) * mix,
        "y": a["y"] + (b["y"] - a["y"]) * mix,
        "z": a["z"] + (b["z"] - a["z"]) * mix,
    }


def draw_synthetic_orbit_frame(width: int, height: int, package: dict | None, prediction: dict | None, frame_idx: int, total_frames: int) -> np.ndarray:
    canvas = np.zeros((height, width, 3), dtype=np.uint8)
    top = np.array([240, 234, 220], dtype=float)
    mid = np.array([208, 226, 207], dtype=float)
    bottom = np.array([107, 184, 116], dtype=float)
    for y in range(height):
        u = y / max(1, height - 1)
        if u < 0.48:
            mix = u / 0.48
            canvas[y, :] = (top * (1 - mix) + mid * mix).astype(np.uint8)
        else:
            mix = (u - 0.48) / 0.52
            canvas[y, :] = (mid * (1 - mix) + bottom * mix).astype(np.uint8)
    rows = synthetic_flight_points(prediction)
    best = best_prediction_row(prediction)
    if not rows:
        cv2.putText(canvas, "Synthetic match unavailable", (36, height // 2), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (245, 248, 248), 2, cv2.LINE_AA)
        return canvas

    profile = field_profile(package)
    u = frame_idx / max(1, total_frames - 1)
    yaw, pitch = camera_view_angles(package, rows, profile)
    roll = 0.0
    range_rings = [radial_points(float(radius)) for radius in profile["rings"]]
    guide_ft = float(profile["guide_ft"])
    left_foul = [{"x": 0.0, "y": 0.0, "z": 0.0}, {"x": math.sin(math.radians(-45)) * guide_ft, "y": math.cos(math.radians(-45)) * guide_ft, "z": 0.0}]
    right_foul = [{"x": 0.0, "y": 0.0, "z": 0.0}, {"x": math.sin(math.radians(45)) * guide_ft, "y": math.cos(math.radians(45)) * guide_ft, "z": 0.0}]
    center_world = {"x": 0.0, "y": guide_ft, "z": 0.0}
    diamond = base_diamond_points(profile)
    fit = fit_app_projection([
        *range_rings,
        [left_foul[-1], right_foul[-1], center_world, {"x": 0.0, "y": 0.0, "z": 0.0}],
        diamond,
        rows,
    ], width, height, yaw, pitch, roll)
    project = lambda point: project_app_point(point, yaw, pitch, roll, fit["scale"], fit["origin_x"], fit["origin_y"])

    for idx, ring in enumerate(range_rings):
        draw_app_path(canvas, ring, project, (245, 248, 248), 2, dash=(5, 7))
        distance = profile["rings"][idx]
        label = project({"x": 0.0, "y": float(distance), "z": 0.0})
        draw_outlined_text(canvas, f"{distance} ft", (int(label["x"] + 8), int(label["y"] + 14)), 0.82, (42, 60, 66), (242, 248, 244), 2, 6)

    draw_app_path(canvas, left_foul, project, (252, 250, 248), 3)
    draw_app_path(canvas, right_foul, project, (252, 250, 248), 3)
    draw_app_path(canvas, diamond, project, (55, 81, 150), 2)
    ground_rows = [{**point, "z": 0.0} for point in rows]
    draw_app_path(canvas, ground_rows, project, (38, 32, 23), 2, dash=(7, 7))
    draw_app_path(canvas, [{"x": 0.0, "y": 0.0, "z": 0.0}, ground_rows[-1]], project, (38, 32, 23), 2, dash=(8, 8))
    draw_app_path(canvas, rows, project, (216, 77, 29), 4)

    progress_index = max(1, min(len(rows) - 1, int(round(u * (len(rows) - 1)))))
    draw_app_path(canvas, rows[:progress_index + 1], project, (68, 68, 239), 6)
    apex_index = max(range(len(rows)), key=lambda idx: rows[idx]["z"])
    apex = project(rows[apex_index])
    end = project(rows[-1])
    ground_end = project(ground_rows[-1])
    ball = project(interpolate_app_point(rows, u))
    base_points = [
        {"x": 0.0, "y": 0.0, "z": 0.0},
        {"x": float(profile["base_ft"]) / math.sqrt(2), "y": float(profile["base_ft"]) / math.sqrt(2), "z": 0.0},
        {"x": 0.0, "y": float(profile["base_ft"]) * math.sqrt(2), "z": 0.0},
        {"x": -float(profile["base_ft"]) / math.sqrt(2), "y": float(profile["base_ft"]) / math.sqrt(2), "z": 0.0},
    ]
    for base_point in base_points:
        base_proj = project(base_point)
        cv2.circle(canvas, (int(base_proj["x"]), int(base_proj["y"])), 4, (255, 255, 255), -1, cv2.LINE_AA)
        cv2.circle(canvas, (int(base_proj["x"]), int(base_proj["y"])), 4, (111, 102, 89), 1, cv2.LINE_AA)
    cv2.circle(canvas, (int(apex["x"]), int(apex["y"])), 6, (68, 68, 239), -1, cv2.LINE_AA)
    cv2.circle(canvas, (int(apex["x"]), int(apex["y"])), 6, (255, 255, 255), 2, cv2.LINE_AA)
    cv2.circle(canvas, (int(end["x"]), int(end["y"])), 5, (255, 93, 22), -1, cv2.LINE_AA)
    cv2.ellipse(canvas, (int(ground_end["x"]), int(ground_end["y"])), (12, 5), 0, 0, 360, (48, 38, 28), -1, cv2.LINE_AA)
    cv2.circle(canvas, (int(ball["x"]), int(ball["y"])), max(7, int(round(10 * ball["perspective"]))), (255, 255, 255), -1, cv2.LINE_AA)
    cv2.circle(canvas, (int(ball["x"]), int(ball["y"])), max(7, int(round(10 * ball["perspective"]))), (28, 28, 185), 2, cv2.LINE_AA)

    center = project(center_world)
    left = project(left_foul[-1])
    right = project(right_foul[-1])
    draw_outlined_text(canvas, "CF", (int(center["x"] - 14), int(center["y"] + 20)), 0.72, (47, 76, 61), (244, 249, 244), 2, 5)
    draw_outlined_text(canvas, "LF line", (int(left["x"] + 8), int(left["y"] + 20)), 0.68, (47, 76, 61), (244, 249, 244), 2, 5)
    draw_outlined_text(canvas, "RF line", (int(right["x"] - 72), int(right["y"] + 20)), 0.68, (47, 76, 61), (244, 249, 244), 2, 5)

    title = "Synthetic Camera View"
    metric = f"{best.get('exit_velocity_mph', 0):.0f} mph / {best.get('launch_angle_deg', 0):.0f} deg / {best.get('distance_ft', 0):.0f} ft"
    cv2.putText(canvas, title, (34, 54), cv2.FONT_HERSHEY_SIMPLEX, 1.18, (248, 252, 250), 4, cv2.LINE_AA)
    cv2.putText(canvas, metric, (34, 96), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (37, 67, 74), 3, cv2.LINE_AA)
    label = f"{profile['label']} field / camera-angle match"
    cv2.putText(canvas, label, (34, height - 34), cv2.FONT_HERSHEY_SIMPLEX, 0.78, (170, 210, 205), 2, cv2.LINE_AA)
    return canvas


def resized_frame(frame: np.ndarray, max_width: int) -> tuple[np.ndarray, float]:
    h, w = frame.shape[:2]
    if max_width <= 0 or w <= max_width:
        return frame, 1.0
    scale = max_width / w
    out_w = max(2, int(round(w * scale)) // 2 * 2)
    out_h = max(2, int(round(h * scale)) // 2 * 2)
    return cv2.resize(frame, (out_w, out_h), interpolation=cv2.INTER_AREA), scale


def scale_observation_points(rows: list[dict], scale: float) -> list[dict]:
    if abs(scale - 1.0) < 1e-6:
        return rows
    scaled = []
    for row in rows:
        copy = dict(row)
        copy["x"] = row["x"] * scale
        copy["y"] = row["y"] * scale
        scaled.append(copy)
    return scaled


def available_cpu_count() -> int:
    count = getattr(os, 'process_cpu_count', os.cpu_count)()
    return max(1, count or os.cpu_count() or 1)


def render_workers(encoder=None) -> int:
    # Hardware jobs mainly wait on the GPU/driver. Two CPU slots serialized
    # their startup and left the export waiting behind short cards.
    default = 4 if encoder == 'h264_qsv' else max(1, min(4, available_cpu_count()))
    return max(1, min(8, int(os.environ.get("EV_RENDER_WORKERS", str(default)))))


def encoder_threads() -> int:
    default = 1 if available_cpu_count() <= 4 else 2
    return max(1, min(4, int(os.environ.get("EV_ENCODER_THREADS", str(default)))))



def _source_banner_image(width: int, height: int, banner_h: int, lines: list[str]) -> np.ndarray:
    """Bake the constant banner into an alpha overlay once for native FFmpeg compositing."""
    shape = (height, width, 3)
    black = draw_banner(np.zeros(shape, np.uint8), banner_h, lines, "normal").astype(np.float32)
    white = draw_banner(np.full(shape, 255, np.uint8), banner_h, lines, "normal").astype(np.float32)
    alpha = np.clip(np.rint(255 - np.mean(white-black, axis=2)), 0, 255).astype(np.uint8)
    foreground = np.divide(black * 255, alpha[:, :, None], out=np.zeros_like(black),
                           where=alpha[:, :, None] > 0)
    return np.dstack([np.clip(np.rint(foreground), 0, 255).astype(np.uint8), alpha])



def _render_source_chunk(spec: dict) -> None:
    overlay = spec['output'].with_suffix('.png')
    image = _source_banner_image(spec['width'], spec['height'], spec['banner_h'], spec['lines'])
    if not cv2.imwrite(str(overlay), image):
        raise RuntimeError('Could not write video banner')
    fps = spec['fps']
    hold = round(fps * 1.5)
    count = math.ceil((spec['end_s']-spec['start_s']) * fps) + hold
    filters = (f"[0:v]fps={fps:.3f},scale={spec['width']}:{spec['height']}:flags=area,"
               f"tpad=start={hold}:start_mode=clone:stop=2:stop_mode=clone[src];"
               "[src][1:v]overlay=0:0:eof_action=repeat:format=yuv420,format=yuv420p[v]")
    encoding = (["-c:v", "h264_qsv", "-preset", "veryfast", "-global_quality", "18"]
                if spec['encoder'] == 'h264_qsv' else
                ["-c:v", "libx264", "-preset", 'veryfast', "-crf", "18"])
    subprocess.run([
        os.environ.get('FFMPEG_PATH', 'ffmpeg'), '-y', '-v', 'error',
        '-threads', str(encoder_threads()), '-ss', f"{spec['start_s']:.6f}",
        '-t', f"{spec['end_s']-spec['start_s']:.6f}", '-i', str(spec['source_video']),
        '-i', str(overlay), '-filter_complex_threads', '1', '-filter_complex', filters,
        '-map', '[v]', '-frames:v', str(count), '-an', *encoding,
        '-threads', str(encoder_threads()), '-pix_fmt', 'yuv420p', str(spec['output']),
    ], stdin=subprocess.DEVNULL, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, creationflags=encoder_process_flags(spec.get('background',False)))

def _group_static_chunks(specs: list[dict]) -> list[dict]:
    """Encode adjacent still cards in one session, preserving every frame."""
    grouped = []
    for spec in specs:
        if 'image_factory' in spec and grouped and ('image_factory' in grouped[-1] or 'image_sequence' in grouped[-1]):
            previous = grouped[-1]
            if 'image_sequence' not in previous:
                previous = {**previous, 'name':'Metrics and field map', 'image_sequence':[previous]}
                previous.pop('image_factory')
                grouped[-1] = previous
            previous['image_sequence'].append(spec)
        else:
            grouped.append(spec)
    return grouped


def _render_static_sequence(spec: dict) -> None:
    inputs, filters, labels = [], [], []
    count = 0
    for index, card in enumerate(spec['image_sequence']):
        image = card['image_factory']()
        png = spec['output'].with_name(f"{spec['output'].stem}-card-{index}.png")
        if not cv2.imwrite(str(png), image):
            raise RuntimeError('Could not write export card')
        inputs.extend(['-framerate',f"{spec['fps']:.3f}",'-i',str(png)])
        filters.append(f"[{index}:v]tpad=stop_mode=clone:stop={max(0,card['count']-1)},trim=end_frame={card['count']},setpts=PTS-STARTPTS,format=yuv420p[card{index}]")
        labels.append(f'[card{index}]')
        count += card['count']
    filters.append(''.join(labels)+f"concat=n={len(labels)}:v=1:a=0[out]")
    encoding = (['-c:v','h264_qsv','-preset','veryfast','-global_quality','18']
                if spec['encoder']=='h264_qsv' else ['-c:v','libx264','-preset','veryfast','-crf','18'])
    subprocess.run([os.environ.get('FFMPEG_PATH','ffmpeg'),'-y','-v','error',*inputs,
        '-filter_complex_threads','1','-filter_complex',';'.join(filters),'-map','[out]',
        '-r',f"{spec['fps']:.3f}",'-frames:v',str(count),'-an',*encoding,
        '-threads',str(encoder_threads()),'-pix_fmt','yuv420p',str(spec['output'])],
        stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,check=True,
        creationflags=encoder_process_flags(spec.get('background',False)))


def _render_chunk(spec: dict) -> Path:
    """Each worker owns its decoder/encoder and writes one complete H.264 chunk."""
    output = spec["output"]
    encoder = spec["encoder"]
    if "source_video" in spec:
        _render_source_chunk(spec)
    elif 'image_sequence' in spec:
        _render_static_sequence(spec)
    elif "image_factory" in spec:
        image = spec["image_factory"]()
        png = output.with_suffix(".png")
        if not cv2.imwrite(str(png), image):
            raise RuntimeError(f"Could not write {png.name}")
        encoding = (["-c:v", "h264_qsv", "-preset", "veryfast", "-global_quality", "18"]
                    if encoder == "h264_qsv" else
                    ["-c:v", "libx264", "-preset", 'veryfast', "-crf", "18"])
        subprocess.run([
            os.environ.get("FFMPEG_PATH", "ffmpeg"), "-y", "-v", "error",
            "-framerate", f'{spec["fps"]:.3f}', "-i", str(png),
            "-filter_threads", "1", "-vf", f'tpad=stop_mode=clone:stop={max(0, spec["count"]-1)}',
            "-frames:v", str(spec["count"]), "-an", *encoding,
            "-threads", str(encoder_threads()), "-pix_fmt", "yuv420p", str(output),
        ], stdin=subprocess.DEVNULL, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, creationflags=encoder_process_flags(spec.get('background',False)))
    else:
        with EncodedFrameWriter(output, spec["fps"], spec["width"], spec["height"], encoder, background=spec.get("background",False)) as writer:
            count = 0
            for frame in spec["frames_factory"]():
                writer.write(frame)
                count += 1
            if not count:
                raise ValueError(f'No frames rendered for {spec["name"]}')
    return output


def _render_chunks(specs: list[dict], workers: int, on_progress=None) -> list[Path]:
    report = on_progress or report_progress
    # Submit every section first. Completion order never determines playback order.
    with ThreadPoolExecutor(max_workers=max(1, workers), thread_name_prefix="ev-export") as pool:
        # Start the expensive moving sections first, instead of leaving the
        # nine-second flight animation waiting behind every short stat card.
        priorities = {'Flight plane': 0, 'Video': 1, 'Metrics and field map': 2, 'Results': 3, 'Field map': 4}
        scheduled = sorted(enumerate(specs), key=lambda pair: priorities.get(pair[1]['name'], 4))
        futures = {pool.submit(_render_chunk, spec): index for index, spec in scheduled}
        outputs = [None] * len(specs)
        try:
            for completed, future in enumerate(as_completed(futures), 1):
                index = futures[future]
                outputs[index] = future.result()
                report(f'{specs[index]["name"]} ready ({completed}/{len(specs)})',
                                0.08 + 0.80 * completed / len(specs))
        except BaseException:
            for future in futures:
                future.cancel()
            raise
    return outputs


def _source_frames(video, start_s, end_s, output_fps, max_width, banner_h, lines):
    cap = cv2.VideoCapture(str(video), cv2.CAP_FFMPEG, [cv2.CAP_PROP_N_THREADS, 1])
    try:
        if not cap.isOpened():
            raise ValueError(f"Could not open video: {video}")
        src_fps = cap.get(cv2.CAP_PROP_FPS) or output_fps
        cap.set(cv2.CAP_PROP_POS_MSEC, start_s * 1000)
        decoded, next_write_t, held = 0, start_s, False
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            decoded += 1
            pos_ms = cap.get(cv2.CAP_PROP_POS_MSEC)
            t = pos_ms / 1000 if pos_ms > 0 else start_s + decoded / src_fps
            if t < start_s - .04:
                continue
            if t > end_s + .04:
                break
            if t + 1e-6 < next_write_t:
                continue
            frame, _ = resized_frame(frame, max_width)
            rendered = draw_banner(frame, banner_h, lines, "normal")
            if not held:
                for _ in range(round(output_fps * 1.5)):
                    yield rendered
                held = True
            yield rendered
            next_write_t += 1 / output_fps
    finally:
        cap.release()


def render_clip(
    video: Path, package: dict, prediction: dict | None, output: Path,
    contact_s: float, pre_s: float, post_s: float, banner_lines: list[str],
    fps: float = 30.0, banner_h: int = 148, max_width: int = 1280,
    on_progress=None, _encoder=None, _background=False,
) -> None:
    report = on_progress or report_progress
    cap = cv2.VideoCapture(str(video), cv2.CAP_FFMPEG, [cv2.CAP_PROP_N_THREADS, 1])
    try:
        if not cap.isOpened():
            raise ValueError(f"Could not open video: {video}")
        src_fps = cap.get(cv2.CAP_PROP_FPS) or fps
        output_fps = max(10., min(float(src_fps), 60.))
        duration = cap.get(cv2.CAP_PROP_FRAME_COUNT) / src_fps
        start_s = max(0., contact_s - pre_s)
        end_s = min(contact_s + post_s, duration) if duration > 0 else contact_s + post_s
        if end_s <= start_s:
            raise ValueError("The requested clip window is empty")
        def read_at(time_s):
            cap.set(cv2.CAP_PROP_POS_MSEC, max(0., time_s) * 1000)
            ok, frame = cap.read()
            if not ok:
                raise ValueError("Could not decode export reference frame")
            return resized_frame(frame, max_width)[0]
        contact_frame = read_at(contact_s)
        last_frame = read_at(max(start_s, end_s - 1 / src_fps))
    finally:
        cap.release()
    height, width = last_frame.shape[:2]
    lines = list(banner_lines) or ["EV n/a    LA n/a    Distance n/a"]
    player_name = str((package.get("hit") or {}).get("player_name") or "").strip()
    if player_name:
        lines.insert(0, player_name)
    encoder = _encoder or video_encoder()
    workers = render_workers(encoder)
    # Avoid multiplying OpenCV's internal pool by the number of section workers.
    if cv2.getNumThreads() != 1:
        cv2.setNumThreads(1)
    output.parent.mkdir(parents=True, exist_ok=True)
    report("building video sections concurrently", .04)
    with tempfile.TemporaryDirectory(prefix="clip_replay_") as temp:
        temp_path = Path(temp)
        specs = []
        def add(name, **kwargs):
            specs.append(dict(name=name, output=temp_path / f"chunk-{len(specs):02}.mp4",
                              encoder=encoder, fps=output_fps, width=width, height=height, background=_background, **kwargs))
        add("Video", source_video=video, start_s=start_s, end_s=end_s,
            banner_h=banner_h, lines=lines)
        stats = focus_stats_from_lines(lines)
        for index, (label, value) in enumerate(stats):
            add(label, count=round(output_fps * 1.25), image_factory=
                lambda label=label, value=value, index=index:
                draw_focus_stat_card(last_frame, label, value, index, len(stats)))
        if actual_field_map_geometry(package):
            add("Field map", count=round(output_fps * 4.75), image_factory=
                lambda: draw_actual_map_evidence_frame(width, height, package, prediction))
        if synthetic_flight_points(prediction):
            def flight_frames():
                from flight_plane import create_flight_plane_animation
                reasons = []
                animation = create_flight_plane_animation(package, prediction, contact_frame,
                                                           on_unavailable=reasons.append)
                if animation is not None:
                    count = round(output_fps * 9.)
                    for index in range(count):
                        yield animation.frame(index, count)
                else:
                    print(json.dumps({"message": "Using synthetic flight view", "reason": reasons}), flush=True)
                    count = round(output_fps * 3.25)
                    for index in range(count):
                        yield draw_synthetic_orbit_frame(width, height, package, prediction, index, count)
            add("Flight plane", frames_factory=flight_frames)
        add("Results", count=round(output_fps * 5.), image_factory=
            lambda: draw_end_card(last_frame, lines, [], prediction))
        chunks = _render_chunks(_group_static_chunks(specs), workers, on_progress=report)
        manifest = temp_path / "chunks.txt"
        # Generated local names avoid concat-demuxer quoting of user paths.
        manifest.write_text("".join(f"file '{chunk.name}'\n" for chunk in chunks), encoding="utf-8")
        assembled = temp_path / "assembled.mp4"
        report("joining video sections and adding audio", .92)
        subprocess.run([
            os.environ.get("FFMPEG_PATH", "ffmpeg"), "-y", "-v", "error",
            "-f", "concat", "-safe", "0", "-i", str(manifest),
            "-ss", f"{start_s:.6f}", "-t", f"{end_s-start_s:.6f}",
            "-i", str(video), "-map", "0:v:0", "-map", "1:a?", "-c:v", "copy",
            "-af", "adelay=1500:all=1", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(assembled),
        ], stdin=subprocess.DEVNULL, check=True, creationflags=encoder_process_flags(_background))
        # Failed workers/assembly never replace an existing export.
        import shutil
        shutil.copyfile(assembled, output)
    report("clip ready", 1.)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--package", required=True, type=Path)
    parser.add_argument("--prediction", type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--contact", required=True, type=float)
    parser.add_argument("--pre", default=1.0, type=float)
    parser.add_argument("--post", default=6.0, type=float)
    parser.add_argument("--banner", default="")
    parser.add_argument("--fps", default=30.0, type=float)
    parser.add_argument("--max-width", default=1280, type=int)
    args = parser.parse_args()

    package = load_json(args.package)
    prediction = load_json(args.prediction) if args.prediction and args.prediction.exists() else None
    render_clip(
        args.video,
        package,
        prediction,
        args.out,
        args.contact,
        args.pre,
        args.post,
        parse_lines(args.banner),
        fps=args.fps,
        max_width=args.max_width,
        _background=os.environ.get("EV_BACKGROUND_RENDER")=="1",
    )
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
