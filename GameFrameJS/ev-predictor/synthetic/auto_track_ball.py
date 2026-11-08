"""Propose early ball observations from video using simple motion tracking.

This is intentionally dependency-light: ffmpeg extracts frames, Pillow reads them,
and NumPy scores frame-difference blobs. The output is an observation package with
COMPUTER_VISION ball observations in the same schema used by the fitter.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import shutil
import subprocess
import tempfile

import numpy as np
from PIL import Image, ImageDraw


def load_package(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def detection_brush(package: dict) -> dict:
    return (package.get("video_metadata") or {}).get("detection_brush") or package.get("detection_brush") or {}


def brush_width_px(package: dict | None = None, default: float = 120.0) -> float:
    hint = detection_brush(package or {})
    try:
        width = float(hint.get("width_px") or default)
    except (TypeError, ValueError, AttributeError):
        width = default
    if not math.isfinite(width):
        width = default
    return max(72.0, min(180.0, width))


def contact_point(package: dict) -> tuple[float, float]:
    observations = package.get("ball_observations") or []
    manual_observations = [
        row
        for row in observations
        if str(row.get("source") or "").upper() != "COMPUTER_VISION"
        and row.get("image_x") is not None
        and row.get("image_y") is not None
    ]
    if manual_observations:
        first = min(manual_observations, key=lambda row: abs(float(row.get("relative_time_s") or 0.0)))
        return float(first["image_x"]), float(first["image_y"])
    hint = detection_brush(package)
    points = hint.get("points") or []
    if points:
        first = points[0]
        if first.get("x") is not None and first.get("y") is not None:
            return float(first["x"]), float(first["y"])
    raise ValueError("Mark the ball at contact before detecting its flight.")


def extract_frames(video: Path, start_s: float, duration_s: float, fps: float, out_dir: Path) -> list[Path]:
    pattern = out_dir / "frame_%04d.png"
    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(video),
        "-ss",
        f"{start_s:.6f}",
        "-t",
        f"{duration_s:.6f}",
        "-vf",
        f"fps={fps}",
        str(pattern),
    ]
    subprocess.run(cmd, check=True)
    return sorted(out_dir.glob("frame_*.png"))


def load_rgb_image(path: Path, scale: float = 1.0) -> Image.Image:
    image = Image.open(path).convert("RGB")
    if scale < 0.999:
        width, height = image.size
        image = image.resize((max(1, int(round(width * scale))), max(1, int(round(height * scale)))), Image.Resampling.BILINEAR)
    return image


def grayscale(path: Path, scale: float = 1.0) -> np.ndarray:
    rgb = np.asarray(load_rgb_image(path, scale), dtype=np.float32)
    return 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]


def rgb_frame(path: Path, scale: float = 1.0) -> np.ndarray:
    return np.asarray(load_rgb_image(path, scale), dtype=np.float32)


def scale_observation_geometry(package: dict, scale: float) -> dict:
    """Return a geometry-only scaled package for faster internal tracking."""
    if scale >= 0.999:
        return package
    scaled = json.loads(json.dumps(package))

    def scale_image_point(row: dict | None) -> None:
        if not isinstance(row, dict):
            return
        for key in ("image_x", "image_y"):
            if row.get(key) is not None:
                row[key] = float(row[key]) * scale
        if row.get("uncertainty_px") is not None:
            row["uncertainty_px"] = float(row["uncertainty_px"]) * scale

    metadata = scaled.get("video_metadata") or {}
    for key in ("width_px", "height_px"):
        if metadata.get(key) is not None:
            metadata[key] = int(round(float(metadata[key]) * scale))
    for hint in (metadata.get("detection_brush"), scaled.get("detection_brush")):
        if not isinstance(hint, dict):
            continue
        if hint.get("width_px") is not None:
            hint["width_px"] = float(hint["width_px"]) * scale
        for point in hint.get("points") or []:
            if not isinstance(point, dict):
                continue
            if point.get("x") is not None:
                point["x"] = float(point["x"]) * scale
            if point.get("y") is not None:
                point["y"] = float(point["y"]) * scale
    for row in scaled.get("ball_observations") or []:
        scale_image_point(row)
    for row in scaled.get("landmarks") or []:
        scale_image_point(row)
    scale_image_point(((scaled.get("hit") or {}).get("contact") or {}))
    return scaled


def unscale_track(track: list[dict], scale: float) -> list[dict]:
    if scale >= 0.999:
        return track
    factor = 1.0 / scale
    unscaled = []
    for point in track:
        row = dict(point)
        for key in ("x", "y", "raw_x", "raw_y"):
            if row.get(key) is not None:
                row[key] = float(row[key]) * factor
        for key in ("prediction_error_px", "brush_hint_distance_px", "brush_line_distance_px", "brush_progress_px"):
            if row.get(key) is not None:
                row[key] = float(row[key]) * factor
        for key in ("path_vx_px_per_frame", "path_vy_px_per_frame", "path_ay_px_per_frame2"):
            if row.get(key) is not None:
                row[key] = float(row[key]) * factor
        if row.get("bbox"):
            row["bbox"] = [int(round(float(value) * factor)) for value in row["bbox"]]
        unscaled.append(row)
    return unscaled


def connected_components(mask: np.ndarray) -> list[np.ndarray]:
    visited = np.zeros(mask.shape, dtype=bool)
    ys, xs = np.nonzero(mask)
    components: list[np.ndarray] = []
    height, width = mask.shape
    for start_y, start_x in zip(ys, xs):
        if visited[start_y, start_x]:
            continue
        stack = [(int(start_y), int(start_x))]
        visited[start_y, start_x] = True
        pts = []
        while stack:
            y, x = stack.pop()
            pts.append((y, x))
            for ny in range(max(0, y - 1), min(height, y + 2)):
                for nx in range(max(0, x - 1), min(width, x + 2)):
                    if mask[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = True
                        stack.append((ny, nx))
        components.append(np.asarray(pts, dtype=np.int32))
    return components


def motion_candidates(
    prev_gray: np.ndarray,
    gray: np.ndarray,
    frame_index: int,
    contact_xy: tuple[float, float],
) -> list[dict]:
    diff = np.abs(gray - prev_gray)
    contact_x, contact_y = contact_xy

    # Keep the search near the batted-ball area without assuming left/right field.
    yy, xx = np.indices(diff.shape)
    max_dx = 170 + 35 * frame_index
    roi = (np.abs(xx - contact_x) <= max_dx) & (yy <= contact_y + 100)

    roi_values = diff[roi]
    if roi_values.size == 0:
        return []
    threshold = max(18.0, float(np.quantile(roi_values, 0.9975)))
    mask = (diff >= threshold) & roi

    candidates = []
    for comp in connected_components(mask):
        area = len(comp)
        if area < 2 or area > 260:
            continue
        ys = comp[:, 0]
        xs = comp[:, 1]
        width = int(xs.max() - xs.min() + 1)
        height = int(ys.max() - ys.min() + 1)
        if width > 42 or height > 42:
            continue
        weights = diff[ys, xs] + 1.0
        x = float(np.average(xs, weights=weights))
        y = float(np.average(ys, weights=weights))
        energy = float(weights.sum())
        compact = area / max(width * height, 1)
        direction_bonus = 1.0
        if frame_index <= 10 and y > contact_y + 20:
            direction_bonus *= 0.35
        score = energy * direction_bonus / math.sqrt(area)
        candidates.append(
            {
                "x": x,
                "y": y,
                "score": score,
                "area": area,
                "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
                "threshold": threshold,
                "compactness": compact,
            }
        )
    candidates.sort(key=lambda row: row["score"], reverse=True)
    return candidates[:80]


def bright_streak_candidates(
    gray: np.ndarray,
    frame_index: int,
    contact_xy: tuple[float, float],
) -> list[dict]:
    contact_x, contact_y = contact_xy
    yy, xx = np.indices(gray.shape)
    # The visible ball is often a bright short streak against the background.
    # Keep the region broad and direction-neutral.
    max_dx = 170 + 35 * frame_index
    roi = (np.abs(xx - contact_x) <= max_dx) & (yy <= contact_y + 40)
    if frame_index <= 10:
        roi &= yy <= contact_y - 10

    values = gray[roi]
    if values.size == 0:
        return []
    threshold = max(118.0, float(np.quantile(values, 0.992)))
    mask = (gray >= threshold) & roi

    candidates = []
    for comp in connected_components(mask):
        area = len(comp)
        if area < 8 or area > 900:
            continue
        ys = comp[:, 0]
        xs = comp[:, 1]
        width = int(xs.max() - xs.min() + 1)
        height = int(ys.max() - ys.min() + 1)
        if width > 130 or height > 55:
            continue
        if width < 5 or height < 3:
            continue

        # Reject long net strands and lights; a ball blur is compact-ish and short.
        aspect = width / max(height, 1)
        if aspect > 8.0 or aspect < 0.25:
            continue
        local = gray[max(0, ys.min() - 18) : ys.max() + 19, max(0, xs.min() - 18) : xs.max() + 19]
        contrast = float(np.mean(gray[ys, xs]) - np.median(local))
        if contrast < 18.0:
            continue

        weights = np.maximum(gray[ys, xs] - np.median(local), 1.0)
        x = float(np.average(xs, weights=weights))
        y = float(np.average(ys, weights=weights))
        expected_y = contact_y - 62.0 * frame_index
        prior_dist = abs(y - expected_y)
        score = (contrast * math.sqrt(area) + 0.2 * float(weights.sum())) - 0.45 * prior_dist
        candidates.append(
            {
                "x": x,
                "y": y,
                "score": score,
                "area": area,
                "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
                "threshold": threshold,
                "compactness": area / max(width * height, 1),
                "source_kind": "bright_streak",
            }
        )
    candidates.sort(key=lambda row: row["score"], reverse=True)
    return candidates[:60]


def merge_candidates(motion: list[dict], bright: list[dict]) -> list[dict]:
    merged = []
    for cand in motion:
        row = dict(cand)
        row.setdefault("source_kind", "motion")
        merged.append(row)
    for cand in bright:
        row = dict(cand)
        row["score"] = row["score"] * 1.35
        merged.append(row)
    merged.sort(key=lambda row: row["score"], reverse=True)
    return merged[:120]


def choose_track(candidate_frames: list[list[dict]], contact_xy: tuple[float, float]) -> list[dict]:
    track = []
    last_x, last_y = contact_xy
    vx = vy = None
    for frame_index, candidates in enumerate(candidate_frames, start=1):
        if not candidates:
            break
        if vx is None:
            pred_x, pred_y = last_x - 120.0, last_y - 105.0
            max_radius = 220.0
        else:
            pred_x, pred_y = last_x + vx, last_y + vy
            max_radius = 115.0

        ranked = []
        for cand in candidates:
            dx = cand["x"] - pred_x
            dy = cand["y"] - pred_y
            dist = math.hypot(dx, dy)
            if dist > max_radius:
                continue
            motion_horizontal = abs(cand["x"] - last_x)
            motion_up = max(0.0, last_y - cand["y"])
            direction = min(1.0, (motion_horizontal + 0.5 * motion_up) / 55.0)
            if frame_index <= 8 and motion_up < 15:
                direction -= 1.5
            if cand.get("source_kind") == "bright_streak":
                direction += 0.75
            smooth_cost = dist / max_radius
            evidence = max(float(cand["score"]), 0.0)
            value = math.log1p(evidence) + direction - 1.7 * smooth_cost
            ranked.append((value, dist, cand))
        if not ranked:
            break
        ranked.sort(key=lambda row: row[0], reverse=True)
        _, dist, best = ranked[0]
        if vx is None:
            vx = best["x"] - last_x
            vy = best["y"] - last_y
        else:
            new_vx = best["x"] - last_x
            new_vy = best["y"] - last_y
            vx = 0.65 * vx + 0.35 * new_vx
            vy = 0.65 * vy + 0.35 * new_vy
        best = dict(best)
        best["frame_index"] = frame_index
        best["prediction_error_px"] = round(dist, 2)
        track.append(best)
        last_x, last_y = best["x"], best["y"]
    return track


def local_max_response(arr: np.ndarray, radius: int = 5) -> np.ndarray:
    out = arr.copy()
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            if dx == 0 and dy == 0:
                continue
            src = arr[
                max(0, -dy) : arr.shape[0] - max(0, dy),
                max(0, -dx) : arr.shape[1] - max(0, dx),
            ]
            dst = out[
                max(0, dy) : out.shape[0] - max(0, -dy),
                max(0, dx) : out.shape[1] - max(0, -dx),
            ]
            np.maximum(dst, src, out=dst)
    return out


def image_away_sign(package: dict) -> int | None:
    """Return expected image-y direction for balls moving away from contact.

    Negative means the path should initially move upward in the image. Positive
    means it should move downward in the image. This is perspective direction,
    not physical launch angle, so it also applies to many ground balls.
    """
    vantage = str((package.get("camera") or {}).get("vantage") or "").lower()
    if "outfield" in vantage:
        return 1
    if any(key in vantage for key in ("backstop", "behind_home", "base_line", "third_base", "first_base")):
        return -1
    return None


def expected_image_direction(package: dict) -> tuple[float, float] | None:
    """Approximate image direction from contact toward the field/landing area."""
    away_sign = image_away_sign(package)
    if away_sign is None:
        return None
    direction = str(((package.get("hit") or {}).get("direction_observation") or {}).get("value") or "").lower()
    if "left" in direction or "third_base" in direction:
        x = -0.85
    elif "right" in direction or "first_base" in direction:
        x = 0.85
    else:
        x = 0.0
    y = float(away_sign)
    norm = math.hypot(x, y)
    if norm <= 1e-6:
        return None
    guessed = (x / norm, y / norm)

    landmarks = package.get("landmarks") or []
    home = next((row for row in landmarks if row.get("landmark") == "home_plate"), None)
    rubber = next((row for row in landmarks if row.get("landmark") == "pitching_rubber"), None)
    if home and rubber and home.get("image_x") is not None and rubber.get("image_x") is not None:
        field_x = float(rubber["image_x"]) - float(home["image_x"])
        field_y = float(rubber["image_y"]) - float(home["image_y"])
        field_norm = math.hypot(field_x, field_y)
        if field_norm > 1e-6:
            center = (field_x / field_norm, field_y / field_norm)
            # Keep the rubber/home line as a sanity check elsewhere, but do not
            # let it override the visible streak direction. From oblique phone
            # views the rubber vector can be nearly horizontal while the ball
            # streak climbs sharply through the image.
            _ = center
    return guessed


def best_local_peak(response: np.ndarray, x: float, y: float, radius: int = 16) -> tuple[float, float, float]:
    height, width = response.shape
    xi = int(round(x))
    yi = int(round(y))
    x0 = max(0, xi - radius)
    x1 = min(width, xi + radius + 1)
    y0 = max(0, yi - radius)
    y1 = min(height, yi + radius + 1)
    if x0 >= x1 or y0 >= y1:
        return 0.0, x, y
    patch = response[y0:y1, x0:x1]
    if patch.size == 0:
        return 0.0, x, y
    local_index = int(np.argmax(patch))
    py, px = np.unravel_index(local_index, patch.shape)
    return float(patch[py, px]), float(x0 + px), float(y0 + py)


def rotated_unit(vector: tuple[float, float], degrees: float) -> tuple[float, float]:
    radians = math.radians(degrees)
    cos_t = math.cos(radians)
    sin_t = math.sin(radians)
    x, y = vector
    return x * cos_t - y * sin_t, x * sin_t + y * cos_t


def line_window_peak(
    response: np.ndarray,
    contact_xy: tuple[float, float],
    direction: tuple[float, float],
    distance_px: float,
    along_radius: int = 14,
    perp_radius: int = 5,
) -> tuple[float, float, float, float]:
    contact_x, contact_y = contact_xy
    dir_x, dir_y = direction
    perp_x, perp_y = -dir_y, dir_x
    height, width = response.shape
    best_value = 0.0
    best_s = distance_px
    for ds in range(-along_radius, along_radius + 1, 2):
        s = distance_px + ds
        if s < 0:
            continue
        for dp in range(-perp_radius, perp_radius + 1, 2):
            x = int(round(contact_x + dir_x * s + perp_x * dp))
            y = int(round(contact_y + dir_y * s + perp_y * dp))
            if 0 <= x < width and 0 <= y < height:
                value = float(response[y, x])
                if value > best_value:
                    best_value = value
                    best_s = s
    return best_value, best_s


def forward_line_peak(
    response: np.ndarray,
    contact_xy: tuple[float, float],
    direction: tuple[float, float],
    distance_px: float,
    back_px: int = 8,
    forward_px: int = 42,
    perp_radius: int = 5,
    along_step: int = 3,
    perp_step: int = 2,
) -> tuple[float, float]:
    contact_x, contact_y = contact_xy
    dir_x, dir_y = direction
    perp_x, perp_y = -dir_y, dir_x
    height, width = response.shape
    best_rank = -1.0
    best_value = 0.0
    best_s = distance_px
    best_x = contact_x + dir_x * distance_px
    best_y = contact_y + dir_y * distance_px
    for ds in range(-back_px, forward_px + 1, along_step):
        s = distance_px + ds
        if s < 0:
            continue
        for dp in range(-perp_radius, perp_radius + 1, perp_step):
            x = int(round(contact_x + dir_x * s + perp_x * dp))
            y = int(round(contact_y + dir_y * s + perp_y * dp))
            if 0 <= x < width and 0 <= y < height:
                value = float(response[y, x])
                rank = value + 0.22 * max(0.0, ds)
                if rank > best_rank:
                    best_rank = rank
                    best_value = value
                    best_s = s
                    best_x = float(x)
                    best_y = float(y)
    return best_value, best_s, best_x, best_y


def directed_line_track(
    responses: list[np.ndarray],
    contact_xy: tuple[float, float],
    fps: float,
    expected_dir: tuple[float, float],
) -> list[dict]:
    """Track the moving streak as progress along one coherent image line."""
    if not responses:
        return []
    contact_x, contact_y = contact_xy
    height, width = responses[0].shape
    max_frames = min(12, len(responses))
    scored: list[tuple[float, list[tuple[int, tuple[float, float], float, float, float]], float, float, float]] = []
    seen: set[tuple[float, float, float]] = set()

    def evaluate(angle: float, speed: float, accel: float) -> None:
        key = (round(angle, 3), round(speed, 3), round(accel, 3))
        if key in seen:
            return
        seen.add(key)
        direction = rotated_unit(expected_dir, float(angle))
        score = 0.0
        support = 0
        last_s = 0.0
        points = []
        for frame_index, response in enumerate(responses[:max_frames], start=1):
            predicted_s = float(speed * frame_index + 0.5 * accel * frame_index * frame_index)
            if predicted_s <= last_s + 6.0:
                score -= 30.0
                break
            x = contact_x + direction[0] * predicted_s
            y = contact_y + direction[1] * predicted_s
            if x < 0 or x >= width or y < 0 or y >= height:
                break
            evidence, best_s, peak_x, peak_y = forward_line_peak(response, contact_xy, direction, predicted_s)
            progress = max(0.0, best_s - last_s)
            if evidence >= 24.0 and progress >= 4.0:
                support += 1
                score += min(evidence, 180.0)
                score += min(42.0, progress * 0.32)
            elif evidence >= 24.0:
                score -= 18.0
            else:
                score -= 10.0
            points.append((frame_index, direction, best_s, evidence, predicted_s, peak_x, peak_y))
            last_s = max(last_s, best_s)
        if support < 3:
            score -= 220.0
        if points:
            score += points[-1][2] * 0.62
        scored.append((score, points, float(speed), float(accel), float(angle)))

    for angle in np.arange(-28.0, 28.1, 4.0):
        for speed in np.arange(34.0, 98.1, 6.0):
            for accel in np.arange(0.0, 10.1, 2.0):
                evaluate(float(angle), float(speed), float(accel))

    coarse_best = sorted(scored, key=lambda row: row[0], reverse=True)[:4]
    for _, _, speed, accel, angle in coarse_best:
        for fine_angle in np.arange(angle - 3.0, angle + 3.1, 1.0):
            for fine_speed in np.arange(speed - 4.0, speed + 4.1, 2.0):
                if fine_speed < 22.0:
                    continue
                for fine_accel in np.arange(max(0.0, accel - 1.5), accel + 1.51, 0.75):
                    evaluate(float(fine_angle), float(fine_speed), float(fine_accel))

    if not scored:
        return []
    _, points, speed, accel, angle = max(scored, key=lambda row: row[0])
    track = []
    last_s = 0.0
    for frame_index, direction, best_s, evidence, predicted_s, peak_x, peak_y in points:
        if evidence < 32.0:
            if frame_index <= 3:
                continue
            break
        if best_s <= last_s + 3.0:
            continue
        last_s = max(last_s, best_s)
        x = peak_x
        y = peak_y
        track.append(
            {
                "x": float(x),
                "y": float(y),
                "score": float(evidence),
                "area": 0,
                "bbox": [int(round(x - 5)), int(round(y - 5)), int(round(x + 5)), int(round(y + 5))],
                "threshold": 0,
                "compactness": 0,
                "source_kind": "path_search",
                "frame_index": frame_index,
                "prediction_error_px": 0.0,
                "path_vx_px_per_frame": float(direction[0] * speed),
                "path_vy_px_per_frame": float(direction[1] * speed),
                "path_ay_px_per_frame2": float(accel),
                "path_angle_offset_deg": float(angle),
            }
        )
        if frame_index >= int(0.36 * fps):
            break
    return track


def remove_stalled_points(track: list[dict], min_progress_px: float = 12.0) -> list[dict]:
    if len(track) < 3:
        return track
    filtered = [track[0]]
    for idx, point in enumerate(track[1:], start=1):
        prev = filtered[-1]
        step = math.hypot(float(point["x"]) - float(prev["x"]), float(point["y"]) - float(prev["y"]))
        if step < min_progress_px and idx < len(track) - 1:
            continue
        filtered.append(point)
    return filtered


def smooth_detected_track(track: list[dict], contact_xy: tuple[float, float]) -> list[dict]:
    """Replace local peak jitter with one validated image-space flight line.

    Early ball flight in these clips should be line-like. If the raw detector
    returns a lightning-bolt path, keep only points that agree with one fitted
    path and reject the detection if there is not enough support left.
    """
    if len(track) < 3:
        return track
    frames = np.asarray([float(point["frame_index"]) for point in track], dtype=np.float64)
    xs = np.asarray([float(point["x"]) for point in track], dtype=np.float64)
    ys = np.asarray([float(point["y"]) for point in track], dtype=np.float64)
    scores = np.asarray([max(1.0, min(220.0, float(point.get("score", 1.0)))) for point in track], dtype=np.float64)
    contact_x, contact_y = contact_xy
    raw_dx = xs - contact_x
    raw_dy = ys - contact_y
    distances = np.hypot(raw_dx, raw_dy)
    if float(np.max(distances)) < 35.0:
        return []
    weighted_x = float(np.average(xs, weights=np.sqrt(scores)))
    weighted_y = float(np.average(ys, weights=np.sqrt(scores)))
    dir_x = weighted_x - contact_x
    dir_y = weighted_y - contact_y
    if math.hypot(dir_x, dir_y) < 1e-6:
        dir_x = float(xs[-1] - contact_x)
        dir_y = float(ys[-1] - contact_y)
    norm = math.hypot(dir_x, dir_y)
    if norm < 1e-6:
        return []
    dir_x /= norm
    dir_y /= norm

    along = raw_dx * dir_x + raw_dy * dir_y
    perp = raw_dx * -dir_y + raw_dy * dir_x
    forward = along > 12.0
    if not np.any(forward):
        return []
    span = float(np.max(along[forward]) - np.min(along[forward]))
    allowed_perp = max(18.0, min(38.0, span * 0.085))
    keep = forward & (np.abs(perp) <= allowed_perp)
    if int(np.count_nonzero(keep)) < 3 and len(track) >= 4:
        relaxed = max(allowed_perp, min(48.0, span * 0.12))
        keep = forward & (np.abs(perp) <= relaxed)
        allowed_perp = relaxed
    if int(np.count_nonzero(keep)) < 3:
        return []

    kept_indices = [idx for idx, ok in enumerate(keep.tolist()) if ok]
    kept_indices.sort(key=lambda idx: frames[idx])

    smoothed: list[dict] = []
    last_x, last_y = contact_x, contact_y
    last_along = 0.0
    for point_index in kept_indices:
        point = track[point_index]
        point_along = float(along[point_index])
        if point_along <= last_along + 5.0:
            continue
        smooth_x = float(contact_x + dir_x * point_along)
        smooth_y = float(contact_y + dir_y * point_along)
        raw_error = abs(float(perp[point_index]))
        step = math.hypot(smooth_x - last_x, smooth_y - last_y)
        if step < 5.0:
            continue
        copy = dict(point)
        copy["raw_x"] = float(point["x"])
        copy["raw_y"] = float(point["y"])
        copy["x"] = smooth_x
        copy["y"] = smooth_y
        copy["prediction_error_px"] = max(float(point.get("prediction_error_px", 0.0)), raw_error)
        copy["path_smoothed"] = True
        copy["line_fit_perp_error_px"] = float(raw_error)
        copy["line_fit_allowed_perp_px"] = float(allowed_perp)
        xi = int(round(smooth_x))
        yi = int(round(smooth_y))
        copy["bbox"] = [xi - 5, yi - 5, xi + 5, yi + 5]
        smoothed.append(copy)
        last_x, last_y = smooth_x, smooth_y
        last_along = point_along
    if len(smoothed) < 3:
        return []
    return smoothed


def suppress_nearby_candidates(candidates: list[dict], radius_px: float = 10.0, limit: int = 80) -> list[dict]:
    kept: list[dict] = []
    radius2 = radius_px * radius_px
    for candidate in sorted(candidates, key=lambda row: row["score"], reverse=True):
        if any(
            (candidate["x"] - other["x"]) ** 2 + (candidate["y"] - other["y"]) ** 2 <= radius2
            for other in kept
        ):
            continue
        kept.append(candidate)
        if len(kept) >= limit:
            break
    return kept


def brush_distance_map(
    shape: tuple[int, int],
    points: list[tuple[float, float]] | None,
) -> np.ndarray | None:
    if not points or len(points) < 2:
        return None
    height, width = shape
    yy, xx = np.indices(shape)
    distances = np.full(shape, 9999.0, dtype=np.float32)
    for idx in range(len(points) - 1):
        ax, ay = points[idx]
        bx, by = points[idx + 1]
        vx = bx - ax
        vy = by - ay
        length2 = vx * vx + vy * vy
        if length2 <= 1e-6:
            continue
        t = ((xx - ax) * vx + (yy - ay) * vy) / length2
        t = np.clip(t, 0.0, 1.0)
        cx = ax + vx * t
        cy = ay + vy * t
        distances = np.minimum(distances, np.hypot(xx - cx, yy - cy))
    return distances


def extract_path_candidates(
    diffs: list[np.ndarray],
    responses: list[np.ndarray],
    contact_xy: tuple[float, float],
    expected_dir: tuple[float, float],
    rgb_frames: list[np.ndarray] | None = None,
    max_frames: int | None = None,
    path_hint: list[tuple[float, float]] | None = None,
    brush_width: float = 120.0,
) -> list[list[dict]]:
    """Return only actual image-evidence peaks inside the user-indicated hit wedge."""
    contact_x, contact_y = contact_xy
    dir_x, dir_y = expected_dir
    all_candidates: list[list[dict]] = []
    max_angle = math.radians(40.0)
    min_cos = math.cos(max_angle)
    for frame_index, (diff, response) in enumerate(zip(diffs[:max_frames], responses[:max_frames]), start=1):
        height, width = response.shape
        yy, xx = np.indices(response.shape)
        rel_x = xx.astype(np.float32) - float(contact_x)
        rel_y = yy.astype(np.float32) - float(contact_y)
        dist = np.hypot(rel_x, rel_y)
        along = rel_x * float(dir_x) + rel_y * float(dir_y)
        cos_angle = along / np.maximum(dist, 1e-6)
        min_dist = max(10.0, 13.0 * frame_index)
        max_dist = min(max(width, height) * 0.95, 82.0 * frame_index + 210.0)
        wedge = (along > min_dist) & (dist >= min_dist) & (dist <= max_dist) & (cos_angle >= min_cos)
        search_area = wedge
        brush_distances = brush_distance_map(response.shape, path_hint)
        if brush_distances is not None:
            brush_tube = brush_distances <= brush_width
            search_area = brush_tube & (along > min_dist * 0.45) & (dist >= min_dist * 0.6) & (dist <= max_dist)
        if not np.any(search_area):
            all_candidates.append([])
            continue

        roi_response = response[search_area]
        roi_diff = diff[search_area]
        if brush_distances is not None:
            response_threshold = max(14.0, min(34.0, float(np.quantile(roi_response, 0.970))))
            diff_threshold = max(8.0, min(26.0, float(np.quantile(roi_diff, 0.965))))
        else:
            response_threshold = max(24.0, min(42.0, float(np.quantile(roi_response, 0.990))))
            diff_threshold = max(16.0, min(34.0, float(np.quantile(roi_diff, 0.990))))
        mask = search_area & (response >= response_threshold) & (diff >= diff_threshold)
        ys, xs = np.nonzero(mask)
        frame_candidates = []
        for y, x in zip(ys, xs):
            motion_score = float(response[y, x]) + 0.45 * float(diff[y, x])
            white_score = 0.0
            if rgb_frames is not None and frame_index < len(rgb_frames):
                rgb = rgb_frames[frame_index]
                y0 = max(0, int(y) - 4)
                y1 = min(rgb.shape[0], int(y) + 5)
                x0 = max(0, int(x) - 4)
                x1 = min(rgb.shape[1], int(x) + 5)
                patch = rgb[y0:y1, x0:x1]
                if patch.size:
                    channels_max = patch.max(axis=2)
                    channels_min = patch.min(axis=2)
                    value_mean = float(channels_max.mean())
                    saturation_mean = float(((channels_max - channels_min) / np.maximum(channels_max, 1.0) * 255.0).mean())
                    value_peak = float(channels_max.max())
                    white_score = (
                        max(0.0, value_mean - 135.0) * 0.90
                        + max(0.0, 95.0 - saturation_mean) * 0.45
                        + max(0.0, value_peak - 180.0) * 0.35
                    )
            score = motion_score + white_score * 1.25
            point_along = float((x - contact_x) * dir_x + (y - contact_y) * dir_y)
            perp = abs(float((x - contact_x) * -dir_y + (y - contact_y) * dir_x))
            distance = max(1e-6, math.hypot(float(x - contact_x), float(y - contact_y)))
            contact_alignment = point_along / distance
            frame_candidates.append(
                {
                    "frame_index": frame_index,
                    "x": float(x),
                    "y": float(y),
                    "score": score,
                    "motion_score": motion_score,
                    "white_score": white_score,
                    "raw_response": float(response[y, x]),
                    "raw_diff": float(diff[y, x]),
                    "along": point_along,
                    "perp": perp,
                    "contact_alignment": contact_alignment,
                    "threshold": response_threshold,
                }
            )
        limit = 180 if brush_distances is not None else 130
        all_candidates.append(suppress_nearby_candidates(frame_candidates, radius_px=9.0, limit=limit))
    return all_candidates


def refine_chain_from_white_trail(
    chain: list[dict],
    candidates_by_frame: list[list[dict]],
    contact_xy: tuple[float, float],
) -> list[dict]:
    """Use the late bright trail to re-pick real candidates along one smooth path."""
    if len(chain) < 5:
        return chain
    anchors = [
        node
        for node in chain
        if float(node.get("white_score", 0.0)) >= 48.0 and float(node.get("along", 0.0)) >= 230.0
    ]
    if len(anchors) < 3:
        return chain

    xs = [float(contact_xy[0])] + [float(node["x"]) for node in anchors]
    ys = [float(contact_xy[1])] + [float(node["y"]) for node in anchors]
    weights = [4.0] + [1.0 + min(2.5, float(node.get("white_score", 0.0)) / 55.0) for node in anchors]
    degree = 2 if len(xs) >= 4 else 1
    max_frame = min(len(candidates_by_frame), max(int(node["frame_index"]) for node in chain))
    best_refined: tuple[float, list[dict]] | None = None
    for timing_lag in (0.0, 1.0):
        ts = [0.0] + [max(1.0, float(node["frame_index"]) - timing_lag) for node in anchors]
        try:
            coeff_x = np.polyfit(np.asarray(ts), np.asarray(xs), degree, w=np.asarray(weights))
            coeff_y = np.polyfit(np.asarray(ts), np.asarray(ys), degree, w=np.asarray(weights))
        except np.linalg.LinAlgError:
            continue

        refined: list[dict] = []
        total_score = 0.0
        for frame_index in range(1, max_frame + 1):
            pred_x = float(np.polyval(coeff_x, frame_index))
            pred_y = float(np.polyval(coeff_y, frame_index))
            best: tuple[float, dict] | None = None
            for candidate in candidates_by_frame[frame_index - 1]:
                distance = math.hypot(float(candidate["x"]) - pred_x, float(candidate["y"]) - pred_y)
                radius = 45.0 if frame_index <= 4 else 38.0
                if distance > radius:
                    continue
                score = (
                    min(float(candidate.get("motion_score", candidate["score"])), 90.0)
                    + min(float(candidate.get("white_score", 0.0)), 115.0) * 2.3
                    - distance * 3.8
                )
                if best is None or score > best[0]:
                    best = (score, candidate)
            if best is None:
                continue
            candidate = dict(best[1])
            candidate["path_score"] = best[0]
            candidate["prev_idx"] = None
            candidate["velocity"] = None
            candidate["refined_from_white_trail"] = True
            candidate["refine_timing_lag_frames"] = timing_lag
            refined.append(candidate)
            total_score += best[0]
        if len(refined) >= 3 and (best_refined is None or total_score > best_refined[0]):
            best_refined = (total_score, refined)

    if best_refined is None:
        return chain
    refined = best_refined[1]
    span = float(refined[-1].get("along", 0.0)) - float(refined[0].get("along", 0.0))
    if span < 95.0:
        return chain
    return refined


def brush_hint_points(package: dict) -> list[tuple[float, float]]:
    hint = detection_brush(package)
    points = hint.get("points") or []
    parsed: list[tuple[float, float]] = []
    for point in points:
        try:
            x = float(point.get("x"))
            y = float(point.get("y"))
        except (TypeError, ValueError, AttributeError):
            continue
        if math.isfinite(x) and math.isfinite(y):
            parsed.append((x, y))
    return parsed


def brush_expected_direction(points: list[tuple[float, float]]) -> tuple[float, float] | None:
    if len(points) < 2:
        return None
    start = points[0]
    end = points[-1]
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    norm = math.hypot(dx, dy)
    if norm < 20.0:
        return None
    return dx / norm, dy / norm


def manual_ball_priors(package: dict, fps: float) -> dict[int, tuple[float, float]]:
    priors: dict[int, tuple[float, float]] = {}
    for row in package.get("ball_observations") or []:
        if str(row.get("source") or "").upper() == "COMPUTER_VISION":
            continue
        if row.get("image_x") is None or row.get("image_y") is None:
            continue
        try:
            rel = float(row.get("relative_time_s") or 0.0)
            frame = int(round(rel * fps))
            x = float(row["image_x"])
            y = float(row["image_y"])
        except (TypeError, ValueError):
            continue
        if frame > 0 and math.isfinite(x) and math.isfinite(y):
            priors[frame] = (x, y)
    return priors


def line_sample_score(response: np.ndarray, x0: float, y0: float, x1: float, y1: float, radius: int = 2) -> float:
    length = max(2, int(math.hypot(x1 - x0, y1 - y0)))
    xs = np.linspace(x0, x1, length)
    ys = np.linspace(y0, y1, length)
    height, width = response.shape
    values = []
    for x, y in zip(xs, ys):
        xi = int(round(x))
        yi = int(round(y))
        if xi < 0 or xi >= width or yi < 0 or yi >= height:
            continue
        patch = response[max(0, yi - radius) : min(height, yi + radius + 1), max(0, xi - radius) : min(width, xi + radius + 1)]
        if patch.size:
            values.append(float(np.max(patch)))
    return float(np.mean(values)) if values else 0.0


def line_point_response(response: np.ndarray, x: float, y: float, radius: int = 2) -> float:
    height, width = response.shape
    xi = int(round(x))
    yi = int(round(y))
    if xi < 0 or xi >= width or yi < 0 or yi >= height:
        return 0.0
    patch = response[max(0, yi - radius) : min(height, yi + radius + 1), max(0, xi - radius) : min(width, xi + radius + 1)]
    return float(np.max(patch)) if patch.size else 0.0


def line_exit_progress(contact_x: float, contact_y: float, dir_x: float, dir_y: float, width: int, height: int) -> float:
    limits = []
    if abs(dir_x) > 1e-6:
        limits.extend([(0.0 - contact_x) / dir_x, ((width - 1.0) - contact_x) / dir_x])
    if abs(dir_y) > 1e-6:
        limits.extend([(0.0 - contact_y) / dir_y, ((height - 1.0) - contact_y) / dir_y])
    positive = [value for value in limits if math.isfinite(value) and value > 0]
    return min(positive) if positive else 0.0


def best_line_evidence(response: np.ndarray, contact_x: float, contact_y: float, dir_x: float, dir_y: float, low: float, high: float) -> tuple[float, float]:
    if high <= low:
        return 0.0, low
    samples = []
    step = 1.5
    count = max(1, int(math.ceil((high - low) / step)))
    for idx in range(count + 1):
        progress = min(high, low + idx * step)
        x = contact_x + dir_x * progress
        y = contact_y + dir_y * progress
        evidence = line_point_response(response, x, y, radius=2)
        samples.append((progress, evidence))
    peak = max((evidence for _, evidence in samples), default=0.0)
    if peak <= 0:
        return 0.0, low

    threshold = max(14.0, min(32.0, peak * 0.45))
    best_run = None
    run_start = None
    run_end = None
    run_peak = 0.0
    for progress, evidence in samples:
        if evidence >= threshold:
            if run_start is None:
                run_start = progress
                run_peak = evidence
            else:
                run_peak = max(run_peak, evidence)
            run_end = progress
            continue
        if run_start is not None:
            # A detected smear is the ball during the exposure. Store the farthest
            # end of the farthest visible smear along the known flight line.
            if best_run is None or float(run_end) > best_run[1]:
                best_run = (run_peak, float(run_end))
            run_start = None
            run_end = None
            run_peak = 0.0
    if run_start is not None:
        if best_run is None or float(run_end) > best_run[1]:
            best_run = (run_peak, float(run_end))
    if best_run is not None:
        return float(best_run[0]), float(best_run[1])

    best_progress, best_evidence = max(samples, key=lambda item: (item[1], item[0]))
    return float(best_evidence), float(best_progress)


def manual_line_track(
    responses: list[np.ndarray],
    contact_xy: tuple[float, float],
    priors_by_frame: dict[int, tuple[float, float]],
    fps: float,
    max_frames: int = 12,
) -> list[dict]:
    if not responses or not priors_by_frame:
        return []
    contact_x, contact_y = contact_xy
    anchor_frame = min(frame for frame in priors_by_frame if frame > 0)
    anchor_x, anchor_y = priors_by_frame[anchor_frame]
    dx = anchor_x - contact_x
    dy = anchor_y - contact_y
    anchor_progress = math.hypot(dx, dy)
    if not math.isfinite(anchor_progress) or anchor_progress < 20.0:
        return []
    dir_x = dx / anchor_progress
    dir_y = dy / anchor_progress
    nominal_step = anchor_progress / float(anchor_frame)

    track = []
    supported = 0
    last_x, last_y = contact_x, contact_y
    last_progress = 0.0
    scan_frames = min(anchor_frame, max_frames if max_frames is not None else max(1, round(fps / 3)), len(responses))
    for frame_index, response in enumerate(responses[:scan_frames], start=1):
        max_progress = min(
            anchor_progress,
            line_exit_progress(contact_x, contact_y, dir_x, dir_y, response.shape[1], response.shape[0]),
        )
        if max_progress <= 0:
            break
        if frame_index in priors_by_frame:
            mark_x, mark_y = priors_by_frame[frame_index]
            raw_progress = (mark_x - contact_x) * dir_x + (mark_y - contact_y) * dir_y
            progress = max(0.0, min(max_progress, raw_progress))
            out_x = contact_x + dir_x * progress
            out_y = contact_y + dir_y * progress
            evidence = max(135.0, line_sample_score(response, last_x, last_y, out_x, out_y, radius=2))
            prediction_error = 0.0
            side_error = abs((mark_x - contact_x) * (-dir_y) + (mark_y - contact_y) * dir_x)
            path_source = "manual_line_marked_point"
        else:
            min_progress = max(last_progress + 2.0, 0.0)
            high_progress = max_progress
            if min_progress >= high_progress:
                continue
            evidence, progress = best_line_evidence(response, contact_x, contact_y, dir_x, dir_y, min_progress, high_progress)
            out_x = contact_x + dir_x * progress
            out_y = contact_y + dir_y * progress
            prediction_error = 0.0
            side_error = 0.0
            if evidence < 18.0:
                continue
            path_source = "manual_line_streak_end"
        if progress <= last_progress:
            continue
        if out_x < 0 or out_x >= response.shape[1] or out_y < 0 or out_y >= response.shape[0]:
            break
        if evidence >= 24.0 or frame_index in priors_by_frame:
            supported += 1
        score = float(min(220.0, evidence * 2.2) + max(0.0, nominal_step) * 0.18 - side_error * 3.0)
        track.append(
            {
                "x": float(out_x),
                "y": float(out_y),
                "score": score,
                "area": 0,
                "bbox": [int(round(out_x - 5)), int(round(out_y - 5)), int(round(out_x + 5)), int(round(out_y + 5))],
                "threshold": 0,
                "compactness": 0,
                "source_kind": "path_search",
                "frame_index": frame_index,
                "prediction_error_px": float(prediction_error),
                "manual_line_side_error_px": float(side_error),
                "manual_line_progress_px": float(progress),
                "path_vx_px_per_frame": float(dir_x * nominal_step),
                "path_vy_px_per_frame": float(dir_y * nominal_step),
                "path_ay_px_per_frame2": 0.0,
                "path_source": path_source,
            }
        )
        last_x, last_y = float(out_x), float(out_y)
        last_progress = float(progress)
    if len(track) < min(3, anchor_frame) or supported < min(3, anchor_frame):
        return []
    return track


def orient_brush_hint(points: list[tuple[float, float]], contact_xy: tuple[float, float]) -> list[tuple[float, float]]:
    if len(points) < 2:
        return points
    contact_x, contact_y = contact_xy
    first_distance = math.hypot(points[0][0] - contact_x, points[0][1] - contact_y)
    last_distance = math.hypot(points[-1][0] - contact_x, points[-1][1] - contact_y)
    return list(reversed(points)) if last_distance < first_distance else points


def project_to_brush_line(
    x: float,
    y: float,
    points: list[tuple[float, float]],
) -> tuple[float, float, float, float]:
    if len(points) < 2:
        return x, y, 0.0, 0.0
    ax, ay = points[0]
    bx, by = points[-1]
    vx = bx - ax
    vy = by - ay
    length2 = vx * vx + vy * vy
    if length2 <= 1e-6:
        return ax, ay, math.hypot(x - ax, y - ay), 0.0
    t = max(0.0, min(1.0, ((x - ax) * vx + (y - ay) * vy) / length2))
    px = ax + vx * t
    py = ay + vy * t
    return px, py, math.hypot(x - px, y - py), t


def point_segment_distance(
    px: float,
    py: float,
    ax: float,
    ay: float,
    bx: float,
    by: float,
) -> tuple[float, float]:
    vx = bx - ax
    vy = by - ay
    length2 = vx * vx + vy * vy
    if length2 <= 1e-6:
        return math.hypot(px - ax, py - ay), 0.0
    t = max(0.0, min(1.0, ((px - ax) * vx + (py - ay) * vy) / length2))
    cx = ax + vx * t
    cy = ay + vy * t
    return math.hypot(px - cx, py - cy), t


def brush_hint_score(x: float, y: float, points: list[tuple[float, float]], width: float = 120.0) -> tuple[float, float]:
    if len(points) < 2:
        return 0.0, 9999.0
    best_distance = 9999.0
    best_progress = 0.0
    total_length = 0.0
    best_length_before = 0.0
    best_segment_length = 0.0
    best_t = 0.0
    for idx in range(len(points) - 1):
        ax, ay = points[idx]
        bx, by = points[idx + 1]
        segment_length = math.hypot(bx - ax, by - ay)
        if segment_length <= 1e-6:
            continue
        distance, t = point_segment_distance(x, y, ax, ay, bx, by)
        if distance < best_distance:
            best_distance = distance
            best_length_before = total_length
            best_segment_length = segment_length
            best_t = t
        total_length += segment_length
    if total_length > 1e-6:
        best_progress = (best_length_before + best_t * best_segment_length) / total_length
    if best_distance <= width:
        score = 190.0 * (1.0 - best_distance / width)
    elif best_distance <= width * 2.2:
        score = -70.0 * ((best_distance - width) / (width * 1.2))
    else:
        score = -95.0
    score += best_progress * 30.0
    return score, best_distance


def brush_polyline_samples(points: list[tuple[float, float]], spacing_px: float = 7.0) -> list[tuple[float, float, float]]:
    if len(points) < 2:
        return []
    samples: list[tuple[float, float, float]] = []
    distance_so_far = 0.0
    for idx in range(len(points) - 1):
        ax, ay = points[idx]
        bx, by = points[idx + 1]
        segment_length = math.hypot(bx - ax, by - ay)
        if segment_length <= 1e-6:
            continue
        steps = max(1, int(math.ceil(segment_length / spacing_px)))
        for step in range(steps + 1):
            if idx > 0 and step == 0:
                continue
            t = step / steps
            samples.append((ax + (bx - ax) * t, ay + (by - ay) * t, distance_so_far + segment_length * t))
        distance_so_far += segment_length
    return samples


def brush_sample_at_progress(samples: list[tuple[float, float, float]], progress: float) -> tuple[float, float, float]:
    if not samples:
        return 0.0, 0.0, 0.0
    if progress <= samples[0][2]:
        return samples[0]
    if progress >= samples[-1][2]:
        return samples[-1]
    for idx in range(len(samples) - 1):
        ax, ay, ap = samples[idx]
        bx, by, bp = samples[idx + 1]
        if ap <= progress <= bp:
            span = max(1e-6, bp - ap)
            t = (progress - ap) / span
            return ax + (bx - ax) * t, ay + (by - ay) * t, progress
    return samples[-1]


def brush_sliced_track(
    responses: list[np.ndarray],
    path_hint: list[tuple[float, float]],
    fps: float,
    brush_width: float = 120.0,
    max_frames: int = 12,
) -> list[dict]:
    if len(path_hint) < 2 or not responses:
        return []
    start_x, start_y = path_hint[0]
    end_x, end_y = path_hint[-1]
    dx = end_x - start_x
    dy = end_y - start_y
    total_length = math.hypot(dx, dy)
    if total_length < 24.0:
        return []
    dir_x = dx / total_length
    dir_y = dy / total_length
    perp_x = -dir_y
    perp_y = dir_x

    scan_frames = min(max_frames, len(responses))
    output_frames = max(4, min(scan_frames, 10))
    # Contact/bat/hand motion is the noisiest region. The contact point is
    # emitted separately, so start brush-guided detection farther down the
    # user's flight line instead of letting early bat motion win.
    start_progress = max(42.0, min(total_length * 0.18, 82.0))
    end_progress = total_length
    if total_length > 140.0:
        end_progress = min(total_length, total_length * 0.86)
    half_width = max(72.0, min(150.0, brush_width * 0.82))
    along_half_width = max(45.0, min(105.0, brush_width * 0.58))
    step = 8

    track = []
    last_progress = 0.0
    for idx, response in enumerate(responses[:output_frames], start=1):
        fraction = idx / max(1.0, float(output_frames))
        center_progress = start_progress + (end_progress - start_progress) * fraction
        min_progress = max(start_progress, last_progress + max(9.0, total_length / max(output_frames * 1.65, 1.0)))
        center_x = start_x + dir_x * center_progress
        center_y = start_y + dir_y * center_progress

        best = None
        for along_offset in range(-int(along_half_width), int(along_half_width) + 1, step):
            progress = max(0.0, min(total_length, center_progress + along_offset))
            if progress < min_progress:
                continue
            base_x = start_x + dir_x * progress
            base_y = start_y + dir_y * progress
            for perp_offset in range(-int(half_width), int(half_width) + 1, step):
                probe_x = base_x + perp_x * perp_offset
                probe_y = base_y + perp_y * perp_offset
                evidence, peak_x, peak_y = best_local_peak(response, probe_x, probe_y, radius=6)
                peak_distance = math.hypot(peak_x - base_x, peak_y - base_y)
                if peak_distance > brush_width * 1.35:
                    continue
                rank = min(evidence, 180.0) - abs(along_offset) * 0.05 - abs(perp_offset) * 0.045 - peak_distance * 0.025
                if best is None or rank > best[0]:
                    best = (rank, evidence, progress, peak_distance, peak_x, peak_y)

        if best is None:
            evidence = 0.0
            progress = min(total_length, max(center_progress, min_progress))
            brush_distance = 0.0
            used_prior = True
        else:
            _, evidence, progress, brush_distance, peak_x, peak_y = best
            progress = min(total_length, max(progress, min_progress))
            if evidence < 1.25:
                progress = min(total_length, max(center_progress, min_progress))
                brush_distance = 0.0
                used_prior = True
            else:
                used_prior = False
        line_x = start_x + dir_x * progress
        line_y = start_y + dir_y * progress
        if used_prior:
            out_x = line_x
            out_y = line_y
        else:
            # The brush is a search corridor, not the answer. Keep real evidence
            # inside the corridor and let smoothing handle small visual jitter.
            out_x = peak_x
            out_y = peak_y
        last_progress = progress

        track.append(
            {
                "x": float(out_x),
                "y": float(out_y),
                "score": float(max(evidence, 1.0 if used_prior else evidence)),
                "area": 0,
                "bbox": [int(round(out_x - 5)), int(round(out_y - 5)), int(round(out_x + 5)), int(round(out_y + 5))],
                "threshold": 0,
                "compactness": 0,
                "source_kind": "path_search",
                "frame_index": idx,
                "prediction_error_px": float(brush_distance),
                "path_vx_px_per_frame": float(dir_x),
                "path_vy_px_per_frame": float(dir_y),
                "path_ay_px_per_frame2": 0.0,
                "path_source": "brush_line_prior" if used_prior else "brush_corridor_evidence",
                "brush_progress_px": float(progress),
                "brush_hint_distance_px": float(brush_distance),
            }
        )

    return smooth_detected_track(track, (start_x, start_y))


def global_candidate_path_track(
    diffs: list[np.ndarray],
    responses: list[np.ndarray],
    contact_xy: tuple[float, float],
    fps: float,
    expected_dir: tuple[float, float],
    rgb_frames: list[np.ndarray] | None = None,
    path_hint: list[tuple[float, float]] | None = None,
    brush_width: float = 120.0,
) -> list[dict]:
    """Assemble a coherent dashed trail from real frame candidates, allowing gaps."""
    if not responses:
        return []
    candidates_by_frame = extract_path_candidates(diffs, responses, contact_xy, expected_dir, rgb_frames, path_hint=path_hint, brush_width=brush_width)
    nodes: list[dict] = []
    contact_x, contact_y = contact_xy
    for frame_candidates in candidates_by_frame:
        for candidate in frame_candidates:
            hint_bonus, hint_distance = brush_hint_score(candidate["x"], candidate["y"], path_hint or [], brush_width)
            candidate["brush_hint_distance_px"] = float(hint_distance)
            best_score = (
                min(candidate["motion_score"], 85.0)
                + min(candidate["white_score"], 115.0) * 1.55
                + min(candidate["along"], 520.0) * 0.12
                + float(candidate["contact_alignment"]) * 160.0
                + hint_bonus
            )
            prev_idx: int | None = None
            prev_velocity: tuple[float, float] | None = None
            for idx, prev in enumerate(nodes):
                frame_gap = candidate["frame_index"] - prev["frame_index"]
                if frame_gap <= 0 or frame_gap > 4:
                    continue
                along_step = candidate["along"] - prev["along"]
                if along_step < 34.0 * frame_gap or along_step > 120.0 * frame_gap:
                    continue
                dx = candidate["x"] - prev["x"]
                dy = candidate["y"] - prev["y"]
                step = math.hypot(dx, dy)
                if step <= 1e-6:
                    continue
                alignment = (dx * expected_dir[0] + dy * expected_dir[1]) / step
                if alignment < math.cos(math.radians(38.0)):
                    continue
                velocity = (dx / frame_gap, dy / frame_gap)
                smooth_penalty = 0.0
                if prev.get("velocity") is not None:
                    pvx, pvy = prev["velocity"]
                    smooth_penalty = min(80.0, math.hypot(velocity[0] - pvx, velocity[1] - pvy) * 0.45)
                gap_penalty = 18.0 * (frame_gap - 1) ** 2
                score = (
                    prev["path_score"]
                    + min(candidate["motion_score"], 85.0)
                    + min(candidate["white_score"], 115.0) * 1.55
                    + min(along_step, 92.0) * 1.05
                    + alignment * 260.0
                    + float(candidate["contact_alignment"]) * 180.0
                    + hint_bonus
                    - gap_penalty
                    - smooth_penalty
                )
                if score > best_score:
                    best_score = score
                    prev_idx = idx
                    prev_velocity = velocity
            if prev_idx is None:
                dx = candidate["x"] - contact_x
                dy = candidate["y"] - contact_y
                step = max(1e-6, math.hypot(dx, dy))
                alignment = (dx * expected_dir[0] + dy * expected_dir[1]) / step
                along_per_frame = candidate["along"] / max(1, candidate["frame_index"])
                if alignment < math.cos(math.radians(34.0)) or candidate["along"] > 175.0 or along_per_frame < 24.0:
                    best_score -= 120.0
                prev_velocity = (dx / max(1, candidate["frame_index"]), dy / max(1, candidate["frame_index"]))
            node = dict(candidate)
            node["path_score"] = best_score
            node["prev_idx"] = prev_idx
            node["velocity"] = prev_velocity
            nodes.append(node)

    if not nodes:
        return []

    best_node_idx = max(range(len(nodes)), key=lambda idx: nodes[idx]["path_score"])
    chain = []
    current_idx: int | None = best_node_idx
    while current_idx is not None:
        node = nodes[current_idx]
        chain.append(node)
        current_idx = node.get("prev_idx")
    chain.reverse()

    if len(chain) < 3:
        return []
    span = chain[-1]["along"] - chain[0]["along"]
    if span < 95.0:
        return []
    if chain[0]["frame_index"] > 4:
        return []
    chain = refine_chain_from_white_trail(chain, candidates_by_frame, contact_xy)

    track = []
    for node in chain:
        x = float(node["x"])
        y = float(node["y"])
        track.append(
            {
                "x": x,
                "y": y,
                "score": float(node["score"]),
                "area": 0,
                "bbox": [int(round(x - 5)), int(round(y - 5)), int(round(x + 5)), int(round(y + 5))],
                "threshold": float(node["threshold"]),
                "compactness": 0,
                "source_kind": "path_search",
                "frame_index": int(node["frame_index"]),
                "prediction_error_px": 0.0,
                "path_vx_px_per_frame": float(node["velocity"][0] if node.get("velocity") else 0.0),
                "path_vy_px_per_frame": float(node["velocity"][1] if node.get("velocity") else 0.0),
                "path_ay_px_per_frame2": 0.0,
                "path_source": "global_candidate_path",
                "white_score": float(node.get("white_score", 0.0)),
                "motion_score": float(node.get("motion_score", node.get("score", 0.0))),
                "refined_from_white_trail": bool(node.get("refined_from_white_trail", False)),
                "brush_hint_distance_px": float(node.get("brush_hint_distance_px", 9999.0)),
            }
        )
    return track


def track_progress_span(track: list[dict]) -> float:
    if len(track) < 2:
        return 0.0
    first = track[0]
    return max(
        math.hypot(float(point["x"]) - float(first["x"]), float(point["y"]) - float(first["y"]))
        for point in track[1:]
    )


def composite_line_track(
    responses: list[np.ndarray],
    contact_xy: tuple[float, float],
    fps: float,
    expected_dir: tuple[float, float],
) -> list[dict]:
    """Find the strongest straight dashed trail in a multi-frame motion composite."""
    if not responses:
        return []
    contact_x, contact_y = contact_xy
    height, width = responses[0].shape
    scoring_frames = min(10, len(responses))
    composite = np.maximum.reduce(responses[:scoring_frames])
    line_candidates = []

    for angle in np.arange(-20.0, 20.1, 4.0):
        direction = rotated_unit(expected_dir, float(angle))
        perp = (-direction[1], direction[0])
        for offset in np.arange(-30.0, 30.1, 6.0):
            values = []
            supported_s = []
            for s in np.arange(18.0, 560.1, 9.0):
                x = contact_x + perp[0] * offset + direction[0] * s
                y = contact_y + perp[1] * offset + direction[1] * s
                if x < 0 or x >= width or y < 0 or y >= height:
                    break
                tube_best = 0.0
                for dp in range(-5, 6, 3):
                    tx = int(round(x + perp[0] * dp))
                    ty = int(round(y + perp[1] * dp))
                    if 0 <= tx < width and 0 <= ty < height:
                        tube_best = max(tube_best, float(composite[ty, tx]))
                if tube_best >= 26.0:
                    values.append(min(tube_best, 190.0))
                    supported_s.append(float(s))
            if len(supported_s) < 3:
                continue
            span = max(supported_s) - min(supported_s)
            if span < 90.0:
                continue
            first_s = min(supported_s)
            if first_s > 210.0:
                continue
            score = sum(values) + span * 1.7 + max(supported_s) * 0.28 - abs(offset) * 2.0
            line_candidates.append((score, float(angle), direction, perp, float(offset)))

    if not line_candidates:
        return []

    best = None
    for _, _angle, direction, perp, offset in sorted(line_candidates, key=lambda row: row[0], reverse=True)[:24]:
        frame_hits = []
        for frame_index, response in enumerate(responses[:scoring_frames], start=1):
            best_hit = None
            for s in np.arange(18.0, 560.1, 9.0):
                x = contact_x + perp[0] * offset + direction[0] * s
                y = contact_y + perp[1] * offset + direction[1] * s
                if x < 0 or x >= width or y < 0 or y >= height:
                    break
                tube_best = 0.0
                for dp in range(-5, 6, 3):
                    tx = int(round(x + perp[0] * dp))
                    ty = int(round(y + perp[1] * dp))
                    if 0 <= tx < width and 0 <= ty < height:
                        tube_best = max(tube_best, float(response[ty, tx]))
                if tube_best < 24.0:
                    continue
                rank = min(tube_best, 190.0) + 0.035 * s
                if best_hit is None or rank > best_hit[0]:
                    best_hit = (rank, float(s), float(tube_best))
            if best_hit is not None:
                _, s, evidence = best_hit
                frame_hits.append((frame_index, s, evidence))
        if len(frame_hits) < 3:
            continue
        early_s = [row[1] for row in frame_hits if row[0] <= 3]
        if not early_s or min(early_s) > 130.0:
            continue
        supported_s = [row[1] for row in frame_hits]
        span = max(supported_s) - min(supported_s)
        if span < 95.0:
            continue
        ordered = sorted(frame_hits, key=lambda row: row[0])
        monotone = 0
        reversals = 0
        last_s = None
        for _, s, _ in ordered:
            if last_s is None or s >= last_s + 6.0:
                monotone += 1
                last_s = s
            elif s < last_s - 18.0:
                reversals += 1
        if monotone < 3:
            continue
        first_s = min(supported_s)
        last_s_for_line = max(supported_s)
        net_dx = direction[0] * (last_s_for_line - first_s)
        net_dy = direction[1] * (last_s_for_line - first_s)
        net_norm = math.hypot(net_dx, net_dy)
        if net_norm <= 1e-6:
            continue
        alignment = (net_dx * expected_dir[0] + net_dy * expected_dir[1]) / net_norm
        if alignment < math.cos(math.radians(22.0)):
            continue
        values = [min(row[2], 190.0) for row in frame_hits]
        score = (
            sum(values)
            + span * 1.9
            + monotone * 95.0
            + max(supported_s) * 0.24
            - reversals * 190.0
            - abs(offset) * 2.7
            - min(early_s) * 0.9
        )
        if best is None or score > best[0]:
            best = (score, direction, perp, float(offset), frame_hits)
    if best is None:
        return []

    _, direction, perp, offset, frame_hits = best
    support_by_frame = []
    last_s = 0.0
    last_support_frame = 0
    missed_after_support = 0
    for frame_index, response in enumerate(responses[:scoring_frames], start=1):
        coarse_s = next((s for idx, s, _ in frame_hits if idx == frame_index), None)
        frame_gap = max(1, frame_index - last_support_frame)
        search_min = max(18.0, last_s + 8.0 * frame_gap)
        search_max = min(560.0, last_s + 125.0 * frame_gap)
        if coarse_s is not None:
            search_min = max(18.0, min(search_min, coarse_s - 26.0))
            search_max = min(560.0, max(search_max, coarse_s + 26.0))
        best_peak = None
        for s in np.arange(search_min, search_max + 0.1, 3.0):
            x = contact_x + perp[0] * offset + direction[0] * s
            y = contact_y + perp[1] * offset + direction[1] * s
            if x < 0 or x >= width or y < 0 or y >= height:
                break
            evidence, peak_s = line_window_peak(
                response,
                (contact_x + perp[0] * offset, contact_y + perp[1] * offset),
                direction,
                s,
                along_radius=7,
                perp_radius=4,
            )
            if evidence < 24.0:
                continue
            candidate = (evidence + peak_s * 0.2, evidence, peak_s)
            if best_peak is None or candidate[0] > best_peak[0]:
                best_peak = candidate
        if best_peak is None:
            if support_by_frame:
                missed_after_support += 1
            if missed_after_support > 3:
                break
            continue
        _, evidence, peak_s = best_peak
        if peak_s <= last_s + 2.0:
            continue
        missed_after_support = 0
        last_s = max(last_s, peak_s)
        last_support_frame = frame_index
        x = contact_x + perp[0] * offset + direction[0] * peak_s
        y = contact_y + perp[1] * offset + direction[1] * peak_s
        support_by_frame.append(
            {
                "x": float(x),
                "y": float(y),
                "score": float(evidence),
                "area": 0,
                "bbox": [int(round(x - 5)), int(round(y - 5)), int(round(x + 5)), int(round(y + 5))],
                "threshold": 0,
                "compactness": 0,
                "source_kind": "path_search",
                "frame_index": frame_index,
                "prediction_error_px": 0.0,
                "path_vx_px_per_frame": float(direction[0]),
                "path_vy_px_per_frame": float(direction[1]),
                "path_ay_px_per_frame2": 0.0,
                "path_line_offset_px": float(offset),
                "path_source": "multi_frame_composite_dashed_trail",
            }
        )
    return support_by_frame


def path_search_track(
    grays: list[np.ndarray],
    contact_xy: tuple[float, float],
    fps: float,
    away_y_sign: int | None = None,
    expected_dir: tuple[float, float] | None = None,
    rgb_frames: list[np.ndarray] | None = None,
    path_hint: list[tuple[float, float]] | None = None,
    brush_width: float = 120.0,
    manual_priors: dict[int, tuple[float, float]] | None = None,
) -> list[dict]:
    """Search for a coherent early image-space arc from the contact point.

    This is deliberately conservative: it looks for a coherent early flight
    shape without assuming the ball must move left or right in the image.
    """
    diffs = [np.abs(grays[idx] - grays[idx - 1]) for idx in range(1, len(grays))]
    responses = [local_max_response(diff, radius=5) for diff in diffs]
    if not responses:
        return []
    manual_track = manual_line_track(responses, contact_xy, manual_priors or {}, fps)
    if len(manual_track) >= 3:
        return manual_track
    if path_hint and len(path_hint) >= 2:
        hinted_dir = brush_expected_direction(path_hint)
        if hinted_dir is not None:
            expected_dir = hinted_dir
        brush_track = brush_sliced_track(responses, path_hint, fps, brush_width)
        brush_evidence_points = [
            point
            for point in brush_track
            if point.get("path_source") != "brush_line_prior" and float(point.get("score", 0.0)) > 1.25
        ]
        if len(brush_track) >= 3 and len(brush_evidence_points) >= 3:
            return remove_stalled_points(brush_track, min_progress_px=6.0)
    if expected_dir is not None:
        candidate_track = global_candidate_path_track(diffs, responses, contact_xy, fps, expected_dir, rgb_frames, path_hint, brush_width)
        if len(candidate_track) >= 3:
            return smooth_detected_track(remove_stalled_points(candidate_track), contact_xy)
        if path_hint and len(path_hint) >= 2:
            fallback_track = global_candidate_path_track(diffs, responses, contact_xy, fps, expected_dir, rgb_frames, None, brush_width)
            if len(fallback_track) >= 3:
                return smooth_detected_track(remove_stalled_points(fallback_track), contact_xy)
        composite_track = composite_line_track(responses, contact_xy, fps, expected_dir)
        if len(composite_track) >= 3 and track_progress_span(composite_track) >= 250.0:
            return smooth_detected_track(remove_stalled_points(composite_track), contact_xy)
        line_track = directed_line_track(responses, contact_xy, fps, expected_dir)
        if len(line_track) >= 3:
            return smooth_detected_track(remove_stalled_points(line_track), contact_xy)

    contact_x, contact_y = contact_xy
    height, width = responses[0].shape
    max_vx = max(80.0, width * 0.085)
    max_vy = max(80.0, height * 0.11)
    vxs = np.arange(-max_vx, max_vx + 0.1, 5.0)
    vys = np.arange(-max_vy, max_vy + 0.1, 5.0)
    ays = np.arange(-18.0, 24.1, 3.0)
    params = np.array(np.meshgrid(vxs, vys, ays, indexing="ij")).reshape(3, -1).T
    initial_vy = params[:, 1] + 0.5 * params[:, 2]
    initial_speed = np.hypot(params[:, 0], initial_vy)
    horizontal_speed = np.abs(params[:, 0])
    params = params[(initial_speed >= 24.0) & (horizontal_speed >= 18.0)]
    if away_y_sign:
        initial_vy = params[:, 1] + 0.5 * params[:, 2]
        five_frame_image_displacement = params[:, 1] * 5.0 + 0.5 * params[:, 2] * 25.0
        ten_frame_image_displacement = params[:, 1] * 10.0 + 0.5 * params[:, 2] * 100.0
        params = params[
            (away_y_sign * initial_vy >= 8.0)
            & (away_y_sign * five_frame_image_displacement >= 45.0)
            & (away_y_sign * ten_frame_image_displacement >= away_y_sign * five_frame_image_displacement + 45.0)
        ]
    if expected_dir is not None and len(params):
        initial_vy = params[:, 1] + 0.5 * params[:, 2]
        speed = np.hypot(params[:, 0], initial_vy)
        alignment = (params[:, 0] * expected_dir[0] + initial_vy * expected_dir[1]) / np.maximum(speed, 1e-6)
        params = params[alignment >= math.cos(math.radians(32.0))]
    if len(params) == 0:
        return []
    scores = np.zeros(len(params), dtype=np.float32)
    scored_frames = min(5, len(responses))

    for frame_index, response in enumerate(responses[:scored_frames], start=1):
        xs = np.rint(contact_x + params[:, 0] * frame_index).astype(int)
        ys = np.rint(
            contact_y
            + params[:, 1] * frame_index
            + 0.5 * params[:, 2] * frame_index * frame_index
        ).astype(int)
        ok = (
            (xs >= 0)
            & (xs < width)
            & (ys >= 0)
            & (ys < height)
            & (np.hypot(xs - contact_x, ys - contact_y) >= max(12.0, 24.0 * math.sqrt(frame_index)))
        )
        values = np.zeros(len(params), dtype=np.float32)
        values[ok] = response[ys[ok], xs[ok]]
        scores += values

    top_count = min(300, len(params))
    top_indices = np.argpartition(scores, -top_count)[-top_count:]
    best_refined = None
    refine_frames = min(10, len(responses))
    for param_index in top_indices:
        vx, vy, ay = params[int(param_index)]
        refined_score = 0.0
        support = 0
        points = []
        prev_peak = contact_xy
        for frame_index, response in enumerate(responses[:refine_frames], start=1):
            pred_x = float(contact_x + vx * frame_index)
            pred_y = float(contact_y + vy * frame_index + 0.5 * ay * frame_index * frame_index)
            if pred_x < 0 or pred_x >= width or pred_y < 0 or pred_y >= height:
                break
            if math.hypot(pred_x - contact_x, pred_y - contact_y) < max(12.0, 24.0 * math.sqrt(frame_index)):
                continue
            evidence, peak_x, peak_y = best_local_peak(response, pred_x, pred_y, radius=18)
            along = 0.0
            if expected_dir is not None:
                along = (peak_x - prev_peak[0]) * expected_dir[0] + (peak_y - prev_peak[1]) * expected_dir[1]
            if evidence >= 24.0:
                support += 1
                refined_score += min(evidence, 170.0) + 18.0
                if expected_dir is not None:
                    refined_score += max(-85.0, min(35.0, along * 0.35))
                    if along < 8.0:
                        refined_score -= 55.0
            else:
                refined_score -= 8.0
            points.append((frame_index, pred_x, pred_y, evidence, peak_x, peak_y))
            prev_peak = (peak_x, peak_y)
        if support < 2:
            refined_score -= 120.0
        # Favor paths that keep explaining the dashed trail for more than only the
        # first couple of frames.
        if points:
            refined_score += 0.06 * math.hypot(points[-1][4] - contact_x, points[-1][5] - contact_y)
        if best_refined is None or refined_score > best_refined[0]:
            best_refined = (refined_score, float(vx), float(vy), float(ay), points)
    if best_refined is None:
        return []
    _, vx, vy, ay, selected_points = best_refined
    track = []
    for frame_index, pred_x, pred_y, evidence, peak_x, peak_y in selected_points:
        if evidence < 24.0:
            if frame_index > 8 or track:
                break
            continue
        if frame_index > 8 and evidence < 30.0:
            break
        x = peak_x
        y = peak_y
        xi = int(round(x))
        yi = int(round(y))
        track.append(
            {
                "x": x,
                "y": y,
                "score": evidence,
                "area": 0,
                "bbox": [xi - 5, yi - 5, xi + 5, yi + 5],
                "threshold": 0,
                "compactness": 0,
                "source_kind": "path_search",
                "frame_index": frame_index,
                "prediction_error_px": 0.0,
                "path_vx_px_per_frame": float(vx),
                "path_vy_px_per_frame": float(vy),
                "path_ay_px_per_frame2": float(ay),
            }
        )
        if frame_index >= int(0.36 * fps):
            break
    return smooth_detected_track(track, contact_xy)


def confidence_for(candidate: dict) -> tuple[str, int]:
    error = float(candidate["prediction_error_px"])
    score = float(candidate["score"])
    if candidate.get("source_kind") == "path_search":
        if score >= 135:
            return "MEDIUM", 32
        if score >= 95:
            return "LOW", 48
        return "LOW", 65
    if error <= 35 and score >= 350:
        return "HIGH", 18
    if error <= 65 and score >= 180:
        return "MEDIUM", 28
    return "LOW", 45


def reject_backward_track_points(package: dict, track: list[dict]) -> tuple[list[dict], list[dict]]:
    """Leave impossible detections as gaps; never clamp them onto a flight path."""
    contact_xy = contact_point(package)
    hint = orient_brush_hint(brush_hint_points(package), contact_xy)
    direction = brush_expected_direction(hint) if len(hint) >= 2 else expected_image_direction(package)
    if direction is None:
        # Without a hint, use the track's overall outgoing direction, not each step.
        deltas = [(float(p['x'])-contact_xy[0], float(p['y'])-contact_xy[1]) for p in track
                  if np.isfinite([p.get('x', np.nan), p.get('y', np.nan)]).all()]
        if deltas:
            direction = tuple(np.median(np.asarray(deltas), axis=0))
    norm = 0.0 if direction is None else math.hypot(*direction)
    if norm <= 1e-8:
        return [], [{'frame_index':p.get('frame_index'), 'reason':'no_supported_forward_direction'} for p in track]
    direction = np.asarray(direction)/norm
    accepted, rejected = [], []
    last_progress = 0.0
    last_raw_progress = 0.0
    last_frame = 0
    for point in sorted(track, key=lambda p:float(p['frame_index'])):
        xy = np.array([point['x'], point['y']], dtype=float)
        raw = np.array([point.get('raw_x', point['x']), point.get('raw_y', point['y'])], dtype=float)
        progress = float((xy-contact_xy)@direction)
        raw_progress = float((raw-contact_xy)@direction)
        reason = None
        if point.get('path_source') == 'brush_line_prior':
            reason = 'no_detected_ball_evidence'
        elif not np.isfinite([*xy, *raw, point['frame_index']]).all():
            reason = 'nonfinite_detection'
        elif point['frame_index'] <= last_frame:
            reason = 'duplicate_or_nonforward_frame'
        elif progress <= last_progress or raw_progress <= last_raw_progress:
            reason = 'backward_or_stationary_along_flight'
        if reason:
            rejected.append({'frame_index':point['frame_index'], 'reason':reason,
                             'x':float(xy[0]), 'y':float(xy[1])})
            continue
        accepted.append(point)
        last_progress, last_raw_progress, last_frame = progress, raw_progress, point['frame_index']
    return accepted, rejected


def build_output_package(package: dict, track: list[dict], fps: float) -> dict:
    from observation_validation import reject_early_anchor_arrivals
    output = json.loads(json.dumps(package))
    contact_time = float(output["hit"]["contact"]["timestamp_s"])
    contact_x, contact_y = contact_point(package)
    raw_brush = brush_hint_points(package)
    brush_points = orient_brush_hint(raw_brush, (contact_x, contact_y)) if raw_brush else []
    brush_width = brush_width_px(package)
    track, rejected_points = reject_backward_track_points(package, track)
    observations = [
        {
            "index": 1,
            "video_time_s": round(contact_time, 6),
            "relative_time_s": 0,
            "image_x": round(contact_x, 2),
            "image_y": round(contact_y, 2),
            "uncertainty_px": 30,
            "source": "HUMAN",
            "confidence": "MEDIUM",
            "note": "Contact seed retained for automatic tracking.",
        }
    ]
    for candidate in track:
        x = float(candidate["x"])
        y = float(candidate["y"])
        if len(brush_points) >= 2:
            projected_x, projected_y, line_distance, line_t = project_to_brush_line(x, y, brush_points)
            brush_owned = candidate.get("path_source") in {
                "brush_sliced_path",
                "brush_prior_path",
                "brush_line_prior",
                "brush_line_evidence",
                "brush_corridor_evidence",
            }
            if brush_owned and line_distance > brush_width * 1.75:
                continue
            if candidate.get("path_source") in {"brush_line_prior"}:
                x = projected_x
                y = projected_y
            candidate["brush_line_distance_px"] = float(line_distance)
            candidate["brush_line_t"] = float(line_t)
        rel = candidate["frame_index"] / fps
        confidence, uncertainty = confidence_for(candidate)
        note_prefix = (
            (
                "Brush-guided path candidate; "
                if candidate.get("path_source") in {"brush_sliced_path", "brush_prior_path", "brush_line_prior", "brush_line_evidence", "brush_corridor_evidence"}
                else (
                    "Global multi-frame path candidate; "
                    if candidate.get("path_source") == "global_candidate_path"
                    else (
                        "Multi-frame dashed-trail candidate; "
                        if candidate.get("path_source") == "multi_frame_composite_dashed_trail"
                        else "Directed trail candidate; "
                    )
                )
            )
            if candidate.get("source_kind") == "path_search"
            else "Auto motion candidate; "
        )
        observations.append(
            {
                "index": len(observations) + 1,
                "video_time_s": round(contact_time + rel, 6),
                "relative_time_s": round(rel, 6),
                "image_x": round(x, 2),
                "image_y": round(y, 2),
                "uncertainty_px": uncertainty,
                "source": "COMPUTER_VISION",
                "confidence": confidence,
                "note": (
                    f"{note_prefix}score={candidate['score']:.1f}; "
                    f"prediction_error_px={candidate['prediction_error_px']:.1f}; "
                    f"area={candidate['area']}."
                ),
            }
        )
    observations, anchor_rejections = reject_early_anchor_arrivals(
        observations, 1 / fps, anchors=package.get('ball_observations') or [])
    rejected_points.extend(anchor_rejections)
    output["ball_observations"] = observations
    uses_manual_line = any(
        candidate.get("path_source") in {"manual_line_marked_point", "manual_line_corridor_evidence", "manual_line_scan_evidence", "manual_line_streak_end"}
        for candidate in track
    )
    output["auto_tracking"] = {
        "method": (
            "manual_line_guided_fast_path_v1"
            if uses_manual_line
            else "brush_guided_path_tracking_v1" if brush_hint_points(package) else "global_candidate_path_tracking_v2"
        ),
        "fps": fps,
        "tracked_points": len(observations)-1,
        "rejected_points": rejected_points,
        "forward_progress_required": True,
        "warning": "Scores a coherent multi-frame path from real image evidence; weak frames are treated as gaps.",
    }
    return output


def draw_diagnostic(frame_paths: list[Path], package: dict, track: list[dict], out_path: Path, fps: float) -> None:
    if not frame_paths:
        return
    track, _ = reject_backward_track_points(package, track)
    thumbs = []
    contact_x, contact_y = contact_point(package)
    points_by_frame = {0: {"x": contact_x, "y": contact_y, "confidence": "CONTACT"}}
    for cand in track:
        points_by_frame[cand["frame_index"]] = cand

    for idx, frame_path in enumerate(frame_paths[: min(len(frame_paths), 14)]):
        image = Image.open(frame_path).convert("RGB")
        draw = ImageDraw.Draw(image)
        trail = []
        for trail_idx in sorted(points_by_frame):
            if trail_idx > idx:
                break
            trail_point = points_by_frame[trail_idx]
            trail.append((float(trail_point["x"]), float(trail_point["y"])))
        if len(trail) >= 2:
            draw.line(trail, fill=(255, 170, 35), width=3)
        point = points_by_frame.get(idx)
        if point:
            x = float(point["x"])
            y = float(point["y"])
            raw_x = point.get("raw_x")
            raw_y = point.get("raw_y")
            if raw_x is not None and raw_y is not None and math.hypot(float(raw_x) - x, float(raw_y) - y) > 1.0:
                draw.ellipse((float(raw_x) - 8, float(raw_y) - 8, float(raw_x) + 8, float(raw_y) + 8), outline=(239, 71, 111), width=3)
                draw.line((float(raw_x), float(raw_y), x, y), fill=(239, 71, 111), width=2)
            draw.ellipse((x - 12, y - 12, x + 12, y + 12), outline=(255, 120, 0), width=4)
            draw.text((x + 15, y - 12), f"{idx / fps:.3f}s", fill=(255, 235, 180))
        if idx == 0:
            max_error = max((float(point.get("line_fit_perp_error_px", 0.0)) for point in track), default=0.0)
            allowed_error = max((float(point.get("line_fit_allowed_perp_px", 0.0)) for point in track), default=0.0)
            verdict = "PASS straight path" if len(track) >= 3 else "FAIL no supported straight path"
            draw.rectangle((8, 8, 350, 74), fill=(0, 0, 0))
            draw.text((18, 18), verdict, fill=(180, 255, 210) if len(track) >= 3 else (255, 180, 180))
            draw.text((18, 42), f"accepted={len(track)} max_error={max_error:.1f}px allowed={allowed_error:.1f}px", fill=(255, 255, 255))
        image.thumbnail((360, 203))
        thumbs.append(image.copy())

    cols = 2
    rows = math.ceil(len(thumbs) / cols)
    montage = Image.new("RGB", (cols * 360, rows * 203), (10, 14, 18))
    for idx, thumb in enumerate(thumbs):
        montage.paste(thumb, ((idx % cols) * 360, (idx // cols) * 203))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    montage.save(out_path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("observation_package", type=Path)
    parser.add_argument("--video", default=Path(r"C:\Users\Patrick\Downloads\InShot_20260704_065621235.mp4"), type=Path)
    parser.add_argument("--out", default=Path("comparison_output/observation_package_auto_tracked.json"), type=Path)
    parser.add_argument("--diagnostic", default=Path("analysis_frames/auto_track_diagnostic.jpg"), type=Path)
    parser.add_argument("--fps", default=30.0, type=float)
    parser.add_argument("--duration", default=0.55, type=float)
    parser.add_argument("--method", choices=["path", "blob"], default="path")
    parser.add_argument("--work-width", default=720, type=int)
    args = parser.parse_args()

    package = load_package(args.observation_package)
    contact_time = float(package["hit"]["contact"]["timestamp_s"])

    with tempfile.TemporaryDirectory(prefix="hittrax_frames_") as temp:
        temp_dir = Path(temp)
        frame_paths = extract_frames(args.video, contact_time, args.duration, args.fps, temp_dir)
        if len(frame_paths) < 2:
            raise ValueError("ffmpeg extracted too few frames for tracking.")
        with Image.open(frame_paths[0]) as first_frame:
            source_width, _source_height = first_frame.size
        work_scale = 1.0
        if args.work_width and args.work_width > 0 and source_width > args.work_width:
            work_scale = args.work_width / float(source_width)
        work_package = scale_observation_geometry(package, work_scale)
        contact_xy = contact_point(work_package)
        path_hint = orient_brush_hint(brush_hint_points(work_package), contact_xy)
        brush_width = brush_width_px(work_package)
        manual_priors = manual_ball_priors(work_package, args.fps)
        grays = [grayscale(path, work_scale) for path in frame_paths]
        rgb_frames = [rgb_frame(path, work_scale) for path in frame_paths]
        if args.method == "path":
            track = path_search_track(
                grays,
                contact_xy,
                args.fps,
                image_away_sign(work_package),
                expected_image_direction(work_package),
                rgb_frames,
                path_hint,
                brush_width,
                manual_priors,
            )
        else:
            candidate_frames = []
            for idx in range(1, len(grays)):
                motion = motion_candidates(grays[idx - 1], grays[idx], idx, contact_xy)
                bright = bright_streak_candidates(grays[idx], idx, contact_xy)
                candidate_frames.append(merge_candidates(motion, bright))
            track = choose_track(candidate_frames, contact_xy)
        track = unscale_track(track, work_scale)
        output = build_output_package(package, track, args.fps)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(output, indent=2), encoding="utf-8")
        draw_diagnostic(frame_paths, package, track, args.diagnostic, args.fps)

    print(f"Wrote {args.out}")
    print(f"Wrote {args.diagnostic}")
    print(f"Tracked {len(track)} CV points")
    for obs in output["ball_observations"]:
        print(
            f"{obs['index']:02d} t={obs['relative_time_s']:.3f} "
            f"x={obs['image_x']:.1f} y={obs['image_y']:.1f} "
            f"{obs['source']} {obs['confidence']} +/-{obs['uncertainty_px']}px"
        )


if __name__ == "__main__":
    main()
