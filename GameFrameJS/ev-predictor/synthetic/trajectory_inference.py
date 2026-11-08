"""Track batted-ball flight as a whole trajectory, not per-frame detections.

This is an experimental detector for clips where the baseball often appears as
motion blur or vanishes for a few frames. It scores complete post-contact image
space trajectories against temporal-median residuals and permissive streak
candidates.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont


def load_package(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


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
    hint = (package.get("video_metadata") or {}).get("detection_brush") or package.get("detection_brush") or {}
    points = hint.get("points") or []
    if points:
        first = points[0]
        if first.get("x") is not None and first.get("y") is not None:
            return float(first["x"]), float(first["y"])
    raise ValueError("Mark the ball at contact before detecting its flight.")


def marker_priors(package: dict, fps: float, scale: float) -> dict[int, tuple[float, float]]:
    priors: dict[int, tuple[float, float]] = {}
    for row in package.get("ball_observations") or []:
        if row.get("image_x") is None or row.get("image_y") is None:
            continue
        rel = float(row.get("relative_time_s") or 0.0)
        frame = int(round(rel * fps))
        if frame <= 0:
            continue
        source = str(row.get("source") or "HUMAN").upper()
        if source == "COMPUTER_VISION":
            continue
        priors[frame] = (float(row["image_x"]) * scale, float(row["image_y"]) * scale)
    return priors


def extract_frames(video: Path, start_s: float, duration_s: float, fps: float, out_dir: Path) -> list[Path]:
    pattern = out_dir / "frame_%04d.png"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            f"{start_s:.6f}",
            "-i",
            str(video),
            "-t",
            f"{duration_s:.6f}",
            "-vf",
            f"fps={fps}",
            str(pattern),
        ],
        check=True,
    )
    return sorted(out_dir.glob("frame_*.png"))


def read_gray(path: Path, max_width: int) -> tuple[np.ndarray, float]:
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Could not read {path}")
    scale = 1.0
    if image.shape[1] > max_width:
        scale = max_width / image.shape[1]
        image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).astype(np.float32)
    return gray, scale


def stabilize_frames(grays: list[np.ndarray]) -> list[np.ndarray]:
    if not grays:
        return []
    base = grays[0]
    aligned = [base]
    warp_mode = cv2.MOTION_TRANSLATION
    criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 60, 1e-5)
    for gray in grays[1:]:
        warp = np.eye(2, 3, dtype=np.float32)
        try:
            cv2.findTransformECC(base / 255.0, gray / 255.0, warp, warp_mode, criteria, None, 5)
            aligned.append(
                cv2.warpAffine(
                    gray,
                    warp,
                    (gray.shape[1], gray.shape[0]),
                    flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
                    borderMode=cv2.BORDER_REPLICATE,
                )
            )
        except cv2.error:
            aligned.append(gray)
    return aligned


def trajectory_observations(package: dict, hypothesis: dict, fps: float, scale: float) -> dict:
    output = json.loads(json.dumps(package))
    contact_time = float(output["hit"]["contact"]["timestamp_s"])
    observations = []
    existing = output.get("ball_observations") or []
    contact = min(existing, key=lambda row: abs(float(row.get("relative_time_s") or 0.0))) if existing else None
    if contact:
        observations.append({**contact, "index": 1})
    next_index = len(observations) + 1
    for row in hypothesis.get("evidence", []):
        if not row_is_supported(row):
            continue
        rel = float(row["frame"]) / fps
        observations.append(
            {
                "index": next_index,
                "video_time_s": round(contact_time + rel, 6),
                "relative_time_s": round(rel, 6),
                "image_x": round(float(row["x"]) / scale, 2),
                "image_y": round(float(row["y"]) / scale, 2),
                "uncertainty_px": 34,
                "source": "COMPUTER_VISION",
                "confidence": "MEDIUM" if row["score"] >= 80 else "LOW",
                "note": (
                    "Trajectory-inference matched-filter point; "
                    f"frame_score={row['score']:.1f}; blur={row['blur_score']:.1f}; candidate={row['candidate_score']:.1f}; "
                    f"path_tube={hypothesis.get('trajectory_tube_score', {}).get('score', 0):.1f}."
                ),
            }
        )
        next_index += 1
    output["ball_observations"] = observations
    output["auto_tracking"] = {
        "method": "spatiotemporal_trajectory_inference_v1",
        "hypothesis_score": hypothesis.get("score"),
        "support_frames": hypothesis.get("support_frames"),
        "missing_frames": hypothesis.get("missing_frames"),
        "trajectory_tube_score": hypothesis.get("trajectory_tube_score"),
        "fps": fps,
    }
    return output


def temporal_residuals(grays: list[np.ndarray], radius: int = 3) -> list[np.ndarray]:
    residuals = []
    for idx, gray in enumerate(grays):
        refs = [
            grays[j]
            for j in range(max(0, idx - radius), min(len(grays), idx + radius + 1))
            if j != idx
        ]
        if refs:
            bg = np.median(np.stack(refs, axis=0), axis=0)
        else:
            bg = gray
        residual = cv2.absdiff(gray, bg.astype(np.float32))
        residuals.append(cv2.GaussianBlur(residual, (3, 3), 0))
    return residuals


@dataclass
class Candidate:
    frame: int
    x: float
    y: float
    length: float
    width: float
    angle: float
    residual: float
    contrast: float
    background: float
    whiteness: float
    line_like: float
    area: int
    bbox: tuple[int, int, int, int]


def temporal_backgrounds(grays: list[np.ndarray], radius: int = 3) -> list[np.ndarray]:
    backgrounds = []
    for idx, gray in enumerate(grays):
        refs = [
            grays[j]
            for j in range(max(0, idx - radius), min(len(grays), idx + radius + 1))
            if j != idx
        ]
        if refs:
            backgrounds.append(np.median(np.stack(refs, axis=0), axis=0).astype(np.float32))
        else:
            backgrounds.append(gray)
    return backgrounds


def residuals_from_backgrounds(grays: list[np.ndarray], backgrounds: list[np.ndarray]) -> list[np.ndarray]:
    return [cv2.GaussianBlur(cv2.absdiff(gray, bg), (3, 3), 0) for gray, bg in zip(grays, backgrounds)]


def component_candidates(
    gray: np.ndarray,
    residual: np.ndarray,
    background: np.ndarray,
    frame: int,
    contact_xy: tuple[float, float],
) -> list[Candidate]:
    contact_x, contact_y = contact_xy
    yy, xx = np.indices(gray.shape)
    max_dx = 210 + 42 * frame
    roi = (np.abs(xx - contact_x) <= max_dx) & (yy <= contact_y + 80)
    if frame <= 10:
        roi &= yy <= contact_y + 8
    roi_values = residual[roi]
    if roi_values.size == 0:
        return []
    threshold = max(12.0, float(np.quantile(roi_values, 0.992)))
    local_bright = gray >= (background + 24.0)
    white_enough = gray >= 150.0
    not_static_white = background < 145.0
    mask = ((residual >= threshold) & white_enough & local_bright & not_static_white & roi).astype(np.uint8)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, 8)
    candidates: list[Candidate] = []
    for label in range(1, count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area < 3 or area > 850:
            continue
        x0 = int(stats[label, cv2.CC_STAT_LEFT])
        y0 = int(stats[label, cv2.CC_STAT_TOP])
        w = int(stats[label, cv2.CC_STAT_WIDTH])
        h = int(stats[label, cv2.CC_STAT_HEIGHT])
        if w > 145 or h > 75:
            continue
        pts_y, pts_x = np.nonzero(labels == label)
        vals = residual[pts_y, pts_x] + 1.0
        x = float(np.average(pts_x, weights=vals))
        y = float(np.average(pts_y, weights=vals))
        coords = np.column_stack([pts_x - x, pts_y - y])
        line_like = 0.0
        if len(coords) >= 3:
            cov = np.cov(coords, rowvar=False, aweights=vals)
            eigvals, eigvecs = np.linalg.eigh(cov)
            order = np.argsort(eigvals)
            major = eigvecs[:, order[-1]]
            angle = float(math.atan2(major[1], major[0]))
            length = float(4.0 * math.sqrt(max(eigvals[order[-1]], 1.0)))
            width = float(4.0 * math.sqrt(max(eigvals[order[0]], 1.0)))
            line_like = float(max(eigvals[order[-1]], 1.0) / max(eigvals[order[0]], 1.0))
        else:
            angle = 0.0
            length = float(max(w, h))
            width = float(min(w, h))
            line_like = float(length / max(width, 1.0))
        local = gray[max(0, y0 - 12) : min(gray.shape[0], y0 + h + 12), max(0, x0 - 12) : min(gray.shape[1], x0 + w + 12)]
        contrast = float(np.mean(gray[pts_y, pts_x]) - np.median(local))
        bg_brightness = float(np.mean(background[pts_y, pts_x]))
        whiteness = float(np.mean(gray[pts_y, pts_x] - background[pts_y, pts_x]))
        if contrast < 16.0 or whiteness < 22.0 or bg_brightness > 150.0:
            continue
        if line_like < 2.2 and area > 8:
            continue
        candidates.append(
            Candidate(
                frame=frame,
                x=x,
                y=y,
                length=length,
                width=width,
                angle=angle,
                residual=float(np.mean(vals)),
                contrast=contrast,
                background=bg_brightness,
                whiteness=whiteness,
                line_like=line_like,
                area=area,
                bbox=(x0, y0, x0 + w, y0 + h),
            )
        )
    candidates.sort(
        key=lambda c: c.whiteness * 5.0 + c.residual * math.sqrt(c.area) + max(c.contrast, 0.0) * 3.0,
        reverse=True,
    )
    return candidates[:80]


def line_sample_score(image: np.ndarray, x0: float, y0: float, x1: float, y1: float, radius: int = 2) -> float:
    length = max(2, int(math.hypot(x1 - x0, y1 - y0)))
    xs = np.linspace(x0, x1, length)
    ys = np.linspace(y0, y1, length)
    total = 0.0
    count = 0
    height, width = image.shape
    for x, y in zip(xs, ys):
        xi = int(round(x))
        yi = int(round(y))
        if xi < 0 or xi >= width or yi < 0 or yi >= height:
            continue
        patch = image[max(0, yi - radius) : min(height, yi + radius + 1), max(0, xi - radius) : min(width, xi + radius + 1)]
        total += float(np.max(patch))
        count += 1
    return total / max(count, 1)


def trajectory_tube_score(residuals: list[np.ndarray], rows: list[dict]) -> dict:
    """Score a dashed trajectory without requiring every gap to contain pixels.

    The ball often appears as separated streaks at 30 fps. This score only
    rewards supported frame-to-frame blur segments and leaves blank gaps alone.
    """
    if not rows:
        return {"score": 0.0, "on_path": 0.0, "off_path": 0.0, "frames": 0, "supported_frames": 0}
    scores = []
    on_values = []
    off_values = []
    supported_frames = 0
    for row in rows:
        if not row_is_supported(row):
            continue
        frame = int(row["frame"])
        if frame <= 0 or frame >= len(residuals):
            continue
        image = residuals[frame]
        mask = np.zeros(image.shape, dtype=np.uint8)
        prev = next((candidate for candidate in rows if int(candidate["frame"]) == frame - 1), None)
        if prev is None:
            continue
        supported_frames += 1
        p0 = (int(round(prev["x"])), int(round(prev["y"])))
        p1 = (int(round(row["x"])), int(round(row["y"])))
        cv2.line(mask, p0, p1, 255, thickness=7, lineType=cv2.LINE_AA)
        outer = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31)))
        ring = (outer > 0) & (mask == 0)
        path = mask > 0
        if not np.any(path):
            continue
        on = float(np.mean(image[path]))
        off = float(np.median(image[ring])) if np.any(ring) else 0.0
        scores.append(max(0.0, on - off) * math.sqrt(np.count_nonzero(path)) / 18.0)
        on_values.append(on)
        off_values.append(off)
    if not scores:
        return {"score": 0.0, "on_path": 0.0, "off_path": 0.0, "frames": 0, "supported_frames": supported_frames}
    return {
        "score": float(sum(scores)),
        "on_path": float(np.mean(on_values)),
        "off_path": float(np.mean(off_values)),
        "frames": len(scores),
        "supported_frames": supported_frames,
    }


def row_is_supported(row: dict) -> bool:
    prior_distance = row.get("prior_distance_px")
    if prior_distance is not None and float(prior_distance) > 12.0:
        return False
    if prior_distance is None and row.get("candidate") is None:
        return False
    return (
        row.get("candidate") is not None
        or float(row.get("blur_score") or 0.0) >= 34.0
        or float(row.get("score") or 0.0) >= 105.0
    )


def best_supported_segment(rows: list[dict], min_support: int = 4, max_gap: int = 3) -> list[dict]:
    """Return the best dashed supported part of a trajectory.

    Several unsupported frames are allowed inside a segment because separated
    motion-blur dashes are expected. Leading and trailing misses are trimmed.
    """
    best: list[dict] = []
    current: list[dict] = []
    miss_run = 0
    for row in rows:
        supported = row_is_supported(row)
        if supported:
            miss_run = 0
            current.append(row)
        elif current and miss_run < max_gap:
            miss_run += 1
            current.append(row)
        else:
            trimmed = trim_unsupported_edges(current)
            if segment_support_count(trimmed) >= min_support:
                if segment_value(trimmed) > segment_value(best):
                    best = trimmed
            current = []
            miss_run = 0
    trimmed = trim_unsupported_edges(current)
    if segment_support_count(trimmed) >= min_support:
        if segment_value(trimmed) > segment_value(best):
            best = trimmed
    return best


def trim_unsupported_edges(rows: list[dict]) -> list[dict]:
    start = 0
    end = len(rows)
    while start < end and not row_is_supported(rows[start]):
        start += 1
    while end > start and not row_is_supported(rows[end - 1]):
        end -= 1
    return rows[start:end]


def segment_support_count(rows: list[dict]) -> int:
    return sum(1 for item in rows if row_is_supported(item))


def segment_value(rows: list[dict]) -> float:
    if not rows:
        return 0.0
    support_bonus = 32.0 * segment_support_count(rows)
    gap_cost = 10.0 * sum(1 for item in rows if not row_is_supported(item))
    return sum(float(item["score"]) for item in rows if row_is_supported(item)) + support_bonus - gap_cost


def nearest_candidate_score(candidates: list[Candidate], x: float, y: float, dx: float, dy: float) -> tuple[float, Candidate | None]:
    if not candidates:
        return 0.0, None
    predicted_angle = math.atan2(dy, dx) if abs(dx) + abs(dy) > 1e-6 else 0.0
    displacement = max(1.0, math.hypot(dx, dy))
    best_score = 0.0
    best_candidate = None
    for cand in candidates:
        dist = math.hypot(cand.x - x, cand.y - y)
        if dist > 14:
            continue
        if cand.width > 10 or cand.length > max(62.0, displacement * 0.95):
            continue
        if cand.background > 150.0 or cand.whiteness < 22.0 or cand.contrast < 16.0:
            continue
        if cand.area > 120 and cand.length < displacement * 0.25:
            continue
        if cand.area > 95 and cand.line_like < 3.0:
            continue
        angle_delta = abs(math.atan2(math.sin(cand.angle - predicted_angle), math.cos(cand.angle - predicted_angle)))
        orientation = abs(math.cos(angle_delta))
        if orientation < 0.55 and cand.length > 8:
            continue
        length_target = max(6.0, min(70.0, displacement * 0.45))
        length_ratio = cand.length / length_target
        length_score = math.exp(-(math.log(max(length_ratio, 0.08)) ** 2) / (2 * 0.85 * 0.85))
        width_score = math.exp(-max(0.0, cand.width - 5.5) / 3.0)
        line_score = min(1.0, cand.line_like / 6.0)
        size_score = 0.25 + 0.75 * length_score * width_score * line_score
        score = (
            cand.whiteness * 9.0
            + cand.residual * math.sqrt(cand.area)
            + max(cand.contrast, 0.0) * 5.0
        ) * math.exp(-(dist * dist) / (2 * 14 * 14))
        score *= (0.25 + 0.75 * orientation) * size_score
        if score > best_score:
            best_score = score
            best_candidate = cand
    return best_score, best_candidate


def local_peak(image: np.ndarray, x: float, y: float, radius: int = 10) -> tuple[float, float, float]:
    height, width = image.shape
    cx = int(round(x))
    cy = int(round(y))
    x0 = max(0, cx - radius)
    x1 = min(width, cx + radius + 1)
    y0 = max(0, cy - radius)
    y1 = min(height, cy + radius + 1)
    if x0 >= x1 or y0 >= y1:
        return 0.0, x, y
    patch = image[y0:y1, x0:x1]
    if patch.size == 0:
        return 0.0, x, y
    local_index = int(np.argmax(patch))
    py, px = np.unravel_index(local_index, patch.shape)
    return float(patch[py, px]), float(x0 + px), float(y0 + py)


def generate_trajectories(
    contact_xy: tuple[float, float],
    frame_count: int,
    priors_by_frame: dict[int, tuple[float, float]] | None = None,
) -> np.ndarray:
    contact_x, contact_y = contact_xy
    priors_by_frame = priors_by_frame or {}
    if len(priors_by_frame) >= 3:
        frames_fit = np.array(sorted(priors_by_frame), dtype=np.float32)
        xs_fit = np.array([priors_by_frame[int(frame)][0] - contact_x for frame in frames_fit], dtype=np.float32)
        ys_fit = np.array([priors_by_frame[int(frame)][1] - contact_y for frame in frames_fit], dtype=np.float32)
        x_design = np.column_stack([frames_fit, 0.5 * frames_fit * frames_fit])
        vx_fit, ax_fit = np.linalg.lstsq(x_design, xs_fit, rcond=None)[0]
        y_design = np.column_stack([frames_fit, 0.5 * frames_fit * frames_fit])
        vy_fit, ay_fit = np.linalg.lstsq(y_design, ys_fit, rcond=None)[0]
        vxs = np.arange(vx_fit - 36.0, vx_fit + 36.1, 4.0)
        axs = np.arange(float(ax_fit) - 8.0, float(ax_fit) + 8.1, 2.0)
        vys = np.arange(float(vy_fit) - 36.0, float(vy_fit) + 36.1, 4.0)
        ays = np.arange(max(0.0, float(ay_fit) - 10.0), max(2.5, float(ay_fit) + 10.1), 2.0)
    else:
        vxs = np.arange(-180, 181, 15.0)
        axs = np.array([0.0])
        vys = np.arange(-170, -15, 10.0)
        ays = np.arange(0, 31, 5.0)
    params = np.array(np.meshgrid(vxs, axs, vys, ays, indexing="ij")).reshape(4, -1).T
    frames = np.arange(frame_count, dtype=np.float32)
    xs = contact_x + params[:, 0:1] * frames[None, :] + 0.5 * params[:, 1:2] * frames[None, :] ** 2
    ys = contact_y + params[:, 2:3] * frames[None, :] + 0.5 * params[:, 3:4] * frames[None, :] ** 2
    dxs = params[:, 0:1] + params[:, 1:2] * frames[None, :]
    dys = params[:, 2:3] + params[:, 3:4] * frames[None, :]
    return np.dstack([xs, ys, dxs, dys])


def score_trajectories(
    trajectories: np.ndarray,
    residuals: list[np.ndarray],
    candidates_by_frame: list[list[Candidate]],
    contact_xy: tuple[float, float],
    priors_by_frame: dict[int, tuple[float, float]] | None = None,
) -> list[dict]:
    priors_by_frame = priors_by_frame or {}
    height, width = residuals[0].shape
    contact_x, contact_y = contact_xy
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    center_maps = [cv2.dilate(residual.astype(np.float32), kernel) for residual in residuals]
    coarse_scores = np.zeros(trajectories.shape[0], dtype=np.float32)
    support_counts = np.zeros(trajectories.shape[0], dtype=np.int32)
    missing_counts = np.zeros(trajectories.shape[0], dtype=np.int32)
    for frame in range(1, trajectories.shape[1]):
        xs = np.rint(trajectories[:, frame, 0]).astype(np.int32)
        ys = np.rint(trajectories[:, frame, 1]).astype(np.int32)
        ok = (
            (xs >= 0)
            & (xs < width)
            & (ys >= 0)
            & (ys < height)
            & (np.hypot(xs - contact_x, ys - contact_y) >= max(18.0, 27.0 * math.sqrt(frame)))
        )
        values = np.zeros(trajectories.shape[0], dtype=np.float32)
        values[ok] = center_maps[frame][ys[ok], xs[ok]]
        coarse_scores += values
        if frame in priors_by_frame:
            px, py = priors_by_frame[frame]
            prior_dist = np.hypot(trajectories[:, frame, 0] - px, trajectories[:, frame, 1] - py)
            coarse_scores += (np.exp(-(prior_dist * prior_dist) / (2 * 8.0 * 8.0)) * 320.0).astype(np.float32)
            coarse_scores -= np.minimum(prior_dist, 90.0).astype(np.float32) * 9.0
        support_counts += values > 28.0
        missing_counts += ~ok | (values <= 18.0)
    coarse_scores -= missing_counts.astype(np.float32) * 4.0
    top_indices = np.argsort(coarse_scores)[-420:][::-1]

    scores = []
    for hyp_idx in top_indices:
        total = 0.0
        support = int(support_counts[hyp_idx])
        missing = int(missing_counts[hyp_idx])
        evidence_rows = []
        prev_x, prev_y = contact_x, contact_y
        for frame in range(1, trajectories.shape[1]):
            x, y, dx, dy = trajectories[hyp_idx, frame]
            if x < 0 or x >= width or y < 0 or y >= height:
                missing += 1
                continue
            if math.hypot(x - contact_x, y - contact_y) < max(18.0, 27.0 * math.sqrt(frame)):
                missing += 1
                continue
            blur_score = line_sample_score(residuals[frame], prev_x, prev_y, float(x), float(y), radius=2)
            cand_score, cand = nearest_candidate_score(candidates_by_frame[frame], float(x), float(y), float(dx), float(dy))
            prior_score = 0.0
            prior_distance = None
            if frame in priors_by_frame:
                px, py = priors_by_frame[frame]
                prior_distance = math.hypot(float(x) - px, float(y) - py)
                prior_score = 420.0 * math.exp(-(prior_distance * prior_distance) / (2 * 8.0 * 8.0)) - min(prior_distance, 100.0) * 12.0
            frame_score = blur_score * 2.4 + cand_score * 0.12 + prior_score
            if row_is_supported({"score": frame_score, "blur_score": blur_score, "candidate": None if cand is None else {}}):
                support += 1
            else:
                missing += 1
            total += frame_score
            evidence_rows.append(
                {
                    "frame": frame,
                    "x": float(x),
                    "y": float(y),
                    "score": float(frame_score),
                    "blur_score": float(blur_score),
                    "candidate_score": float(cand_score),
                    "prior_score": float(prior_score),
                    "prior_distance_px": None if prior_distance is None else float(prior_distance),
                    "candidate": None if cand is None else {
                        "x": cand.x,
                        "y": cand.y,
                        "distance_px": math.hypot(cand.x - float(x), cand.y - float(y)),
                        "area": cand.area,
                        "length_px": cand.length,
                        "width_px": cand.width,
                        "angle_deg": math.degrees(cand.angle),
                        "residual": cand.residual,
                        "contrast": cand.contrast,
                        "background": cand.background,
                        "whiteness": cand.whiteness,
                        "line_like": cand.line_like,
                        "why": "near predicted trajectory; plausible streak size; orientation agrees with predicted image velocity",
                    },
                }
            )
            prev_x, prev_y = float(x), float(y)
        if support < 3:
            total *= 0.35
        segment_rows = best_supported_segment(evidence_rows)
        if not segment_rows:
            continue
        if priors_by_frame:
            first_prior_frame = min(priors_by_frame)
            first_prior_row = next((row for row in segment_rows if int(row["frame"]) == first_prior_frame), None)
            if first_prior_row is None or not row_is_supported(first_prior_row):
                continue
        segment_score = segment_value(segment_rows)
        segment_support = sum(1 for row in segment_rows if row_is_supported(row))
        segment_misses = len(segment_rows) - segment_support
        tube = trajectory_tube_score(residuals, segment_rows)
        total = segment_score + tube["score"] * 1.5 - segment_misses * 8.0
        scores.append(
            {
                "hypothesis_index": int(hyp_idx),
                "score": float(total),
                "support_frames": int(segment_support),
                "missing_frames": int(segment_misses),
                "segment_start_frame": int(segment_rows[0]["frame"]),
                "segment_end_frame": int(segment_rows[-1]["frame"]),
                "trajectory_tube_score": tube,
                "evidence": segment_rows,
            }
        )
    scores.sort(key=lambda row: row["score"], reverse=True)
    return scores[:20]


def manual_line_hypothesis(
    residuals: list[np.ndarray],
    candidates_by_frame: list[list[Candidate]],
    contact_xy: tuple[float, float],
    priors_by_frame: dict[int, tuple[float, float]],
    max_frames: int = 12,
) -> dict | None:
    if not priors_by_frame or not residuals:
        return None
    anchor_frame = min(frame for frame in priors_by_frame if frame > 0)
    anchor_x, anchor_y = priors_by_frame[anchor_frame]
    contact_x, contact_y = contact_xy
    vx = (anchor_x - contact_x) / float(anchor_frame)
    vy = (anchor_y - contact_y) / float(anchor_frame)
    speed = math.hypot(vx, vy)
    if not math.isfinite(speed) or speed < 4.0:
        return None

    rows = []
    prev_x, prev_y = contact_x, contact_y
    scan_frames = min(max_frames, len(residuals) - 1)
    for frame in range(1, scan_frames + 1):
        predicted_x = contact_x + vx * frame
        predicted_y = contact_y + vy * frame
        if frame in priors_by_frame:
            predicted_x, predicted_y = priors_by_frame[frame]
            search_radius = 3
            prior_distance = 0.0
        else:
            search_radius = 14 if frame <= anchor_frame + 2 else 20
            prior_distance = 0.0
        if (
            predicted_x < 0
            or predicted_x >= residuals[frame].shape[1]
            or predicted_y < 0
            or predicted_y >= residuals[frame].shape[0]
        ):
            break
        peak_value, peak_x, peak_y = local_peak(residuals[frame], predicted_x, predicted_y, radius=search_radius)
        use_x, use_y = peak_x, peak_y
        dx = use_x - prev_x
        dy = use_y - prev_y
        cand_score, cand = nearest_candidate_score(candidates_by_frame[frame], use_x, use_y, vx, vy)
        if frame in priors_by_frame:
            use_x, use_y = predicted_x, predicted_y
            dx = use_x - prev_x
            dy = use_y - prev_y
            blur_score = line_sample_score(residuals[frame], prev_x, prev_y, use_x, use_y, radius=2)
            frame_score = 520.0 + blur_score * 2.5 + cand_score * 0.12
            source = "marked_manual_point"
        else:
            blur_score = line_sample_score(residuals[frame], prev_x, prev_y, use_x, use_y, radius=2)
            predicted_error = math.hypot(use_x - predicted_x, use_y - predicted_y)
            evidence_score = max(peak_value, blur_score)
            frame_score = (
                blur_score * 2.7
                + cand_score * 0.18
                + min(90.0, peak_value * 1.4)
                - predicted_error * 4.0
            )
            source = "manual_line_corridor_evidence"
            if evidence_score < 20.0 and cand is None:
                frame_score -= 55.0
        rows.append(
            {
                "frame": frame,
                "x": float(use_x),
                "y": float(use_y),
                "score": float(frame_score),
                "blur_score": float(blur_score),
                "candidate_score": float(cand_score),
                "prior_score": 0.0,
                "prior_distance_px": float(prior_distance),
                "manual_line_error_px": float(math.hypot(use_x - predicted_x, use_y - predicted_y)),
                "source": source,
                "candidate": None if cand is None else {
                    "x": cand.x,
                    "y": cand.y,
                    "distance_px": math.hypot(cand.x - use_x, cand.y - use_y),
                    "area": cand.area,
                    "length_px": cand.length,
                    "width_px": cand.width,
                    "angle_deg": math.degrees(cand.angle),
                    "residual": cand.residual,
                    "contrast": cand.contrast,
                    "background": cand.background,
                    "whiteness": cand.whiteness,
                    "line_like": cand.line_like,
                    "why": "inside narrow corridor defined by manual ball marks",
                },
            }
        )
        if row_is_supported(rows[-1]):
            prev_x, prev_y = float(use_x), float(use_y)
        else:
            prev_x, prev_y = predicted_x, predicted_y

    segment_rows = best_supported_segment(rows, min_support=3, max_gap=2)
    if not segment_rows:
        return None
    support = segment_support_count(segment_rows)
    if support < 3:
        return None
    tube = trajectory_tube_score(residuals, segment_rows)
    return {
        "hypothesis_index": -2,
        "source": "manual_line_guided_fast_path",
        "score": float(segment_value(segment_rows) + tube["score"] * 1.6 + support * 95.0),
        "support_frames": int(support),
        "missing_frames": int(len(segment_rows) - support),
        "segment_start_frame": int(segment_rows[0]["frame"]),
        "segment_end_frame": int(segment_rows[-1]["frame"]),
        "trajectory_tube_score": tube,
        "evidence": segment_rows,
    }


def marker_hypothesis(
    residuals: list[np.ndarray],
    candidates_by_frame: list[list[Candidate]],
    contact_xy: tuple[float, float],
    priors_by_frame: dict[int, tuple[float, float]],
) -> dict | None:
    if not priors_by_frame:
        return None
    rows = []
    prev_x, prev_y = contact_xy
    for frame in sorted(priors_by_frame):
        if frame <= 0 or frame >= len(residuals):
            continue
        x, y = priors_by_frame[frame]
        dx = x - prev_x
        dy = y - prev_y
        blur_score = line_sample_score(residuals[frame], prev_x, prev_y, x, y, radius=2)
        cand_score, cand = nearest_candidate_score(candidates_by_frame[frame], x, y, dx, dy)
        frame_score = 420.0 + blur_score * 2.4 + cand_score * 0.12
        rows.append(
            {
                "frame": int(frame),
                "x": float(x),
                "y": float(y),
                "score": float(frame_score),
                "blur_score": float(blur_score),
                "candidate_score": float(cand_score),
                "prior_score": 420.0,
                "prior_distance_px": 0.0,
                "candidate": None if cand is None else {
                    "x": cand.x,
                    "y": cand.y,
                    "distance_px": math.hypot(cand.x - x, cand.y - y),
                    "area": cand.area,
                    "length_px": cand.length,
                    "width_px": cand.width,
                    "angle_deg": math.degrees(cand.angle),
                    "residual": cand.residual,
                    "contrast": cand.contrast,
                    "background": cand.background,
                    "whiteness": cand.whiteness,
                    "line_like": cand.line_like,
                    "why": "near marked dashed trail; video evidence is explanatory, not allowed to move the marked point",
                },
            }
        )
        prev_x, prev_y = x, y
    if not rows:
        return None
    tube = trajectory_tube_score(residuals, rows)
    support = segment_support_count(rows)
    return {
        "hypothesis_index": -1,
        "source": "marked_dashed_trail_prior",
        "score": float(segment_value(rows) + tube["score"] * 1.5),
        "support_frames": int(support),
        "missing_frames": int(len(rows) - support),
        "segment_start_frame": int(rows[0]["frame"]),
        "segment_end_frame": int(rows[-1]["frame"]),
        "trajectory_tube_score": tube,
        "evidence": rows,
    }


def draw_debug(frame_paths: list[Path], top: list[dict], candidates_by_frame: list[list[Candidate]], scale: float, out_path: Path) -> None:
    thumbs = []
    colors = [(255, 80, 80), (80, 220, 255), (120, 255, 120)]
    for frame_idx, frame_path in enumerate(frame_paths[: min(16, len(frame_paths))]):
        img = Image.open(frame_path).convert("RGB")
        if scale != 1.0:
            img = img.resize((int(img.width * scale), int(img.height * scale)))
        draw = ImageDraw.Draw(img)
        for cand in candidates_by_frame[frame_idx][:30]:
            draw.rectangle(cand.bbox, outline=(70, 140, 255), width=1)
        for hyp_rank, hyp in enumerate(top[:3]):
            row = next((item for item in hyp["evidence"] if item["frame"] == frame_idx), None)
            if not row:
                continue
            x = row["x"]
            y = row["y"]
            color = colors[hyp_rank]
            if not row_is_supported(row):
                draw.ellipse((x - 4, y - 4, x + 4, y + 4), outline=(120, 120, 120), width=1)
                continue
            prev_row = next((item for item in hyp["evidence"] if item["frame"] == frame_idx - 1), None)
            if prev_row and hyp_rank == 0:
                draw.line((float(prev_row["x"]), float(prev_row["y"]), x, y), fill=color, width=4)
            draw.ellipse((x - 8, y - 8, x + 8, y + 8), outline=color, width=3)
            tube = hyp.get("trajectory_tube_score", {})
            label = f"#{hyp_rank+1} f{row['score']:.0f}"
            if frame_idx == hyp.get("segment_end_frame"):
                label += f" line{tube.get('score', 0):.0f}"
            draw.text((x + 10, y - 10), label, fill=color)
        img.thumbnail((480, 270))
        thumbs.append(img.copy())
    cols = 2
    rows = math.ceil(len(thumbs) / cols)
    montage = Image.new("RGB", (cols * 480, rows * 270), (10, 14, 18))
    for idx, thumb in enumerate(thumbs):
        montage.paste(thumb, ((idx % cols) * 480, (idx // cols) * 270))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    montage.save(out_path)


def draw_choice_debug(frame_paths: list[Path], best: dict, candidates_by_frame: list[list[Candidate]], scale: float, out_path: Path) -> None:
    rows = [row for row in best.get("evidence", []) if row_is_supported(row)][:14]
    panels = []
    for row in rows:
        frame_idx = int(row["frame"])
        if frame_idx >= len(frame_paths):
            continue
        image = Image.open(frame_paths[frame_idx]).convert("RGB")
        if scale != 1.0:
            image = image.resize((int(image.width * scale), int(image.height * scale)))
        x = float(row["x"])
        y = float(row["y"])
        crop_r = 92
        left = max(0, int(x - crop_r))
        top_y = max(0, int(y - crop_r))
        right = min(image.width, int(x + crop_r))
        bottom = min(image.height, int(y + crop_r))
        crop = image.crop((left, top_y, right, bottom))
        canvas = Image.new("RGB", (520, 230), (8, 12, 16))
        canvas.paste(crop.resize((230, 230)), (0, 0))
        draw = ImageDraw.Draw(canvas)
        px = (x - left) * 230 / max(1, right - left)
        py = (y - top_y) * 230 / max(1, bottom - top_y)
        draw.ellipse((px - 7, py - 7, px + 7, py + 7), outline=(255, 60, 70), width=3)
        for cand in candidates_by_frame[frame_idx][:12]:
            cx = (cand.x - left) * 230 / max(1, right - left)
            cy = (cand.y - top_y) * 230 / max(1, bottom - top_y)
            if -12 <= cx <= 242 and -12 <= cy <= 242:
                draw.rectangle((cx - 6, cy - 6, cx + 6, cy + 6), outline=(70, 170, 255), width=1)
        text_x = 242
        draw.text((text_x, 8), f"frame {frame_idx}  score {row['score']:.1f}", fill=(255, 255, 255))
        draw.text((text_x, 28), f"pred ({row['x']:.1f}, {row['y']:.1f})", fill=(255, 200, 120))
        draw.text((text_x, 48), f"blur {row['blur_score']:.1f}  cand {row['candidate_score']:.1f}", fill=(210, 230, 255))
        cand = row.get("candidate")
        if cand:
            lines = [
                f"chosen dist {cand['distance_px']:.1f}px",
                f"area {cand['area']}  len {cand['length_px']:.1f}",
                f"width {cand['width_px']:.1f}  angle {cand['angle_deg']:.0f}",
                f"resid {cand['residual']:.1f}  contrast {cand['contrast']:.1f}",
                f"white {cand.get('whiteness', 0):.1f}  bg {cand.get('background', 0):.1f}",
                "why: white moving streak near path",
            ]
        else:
            lines = ["no component selected", "score is blur/residual only"]
        for idx, line in enumerate(lines):
            draw.text((text_x, 76 + idx * 20), line, fill=(190, 220, 210))
        panels.append(canvas)
    cols = 1
    rows_n = len(panels)
    montage = Image.new("RGB", (520, max(1, rows_n) * 230), (8, 12, 16))
    for idx, panel in enumerate(panels):
        montage.paste(panel, (0, idx * 230))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    montage.save(out_path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("observation_package", type=Path)
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--out", default=Path("comparison_output/trajectory_inference.json"), type=Path)
    parser.add_argument("--debug", default=Path("analysis_frames/trajectory_inference_debug.jpg"), type=Path)
    parser.add_argument("--choice-debug", default=Path("analysis_frames/trajectory_inference_choice_debug.jpg"), type=Path)
    parser.add_argument("--package-out", default=Path("comparison_output/trajectory_inference_package.json"), type=Path)
    parser.add_argument("--fps", default=30.0, type=float)
    parser.add_argument("--duration", default=0.9, type=float)
    parser.add_argument("--max-width", default=960, type=int)
    parser.add_argument("--no-stabilize", action="store_true")
    args = parser.parse_args()

    package = load_package(args.observation_package)
    contact_time = float(package["hit"]["contact"]["timestamp_s"])
    contact_xy_full = contact_point(package)
    with tempfile.TemporaryDirectory(prefix="trajectory_frames_") as temp:
        frame_paths = extract_frames(args.video, contact_time, args.duration, args.fps, Path(temp))
        raw_grays = []
        scale = 1.0
        for path in frame_paths:
            gray, scale = read_gray(path, args.max_width)
            raw_grays.append(gray)
        contact_xy = (contact_xy_full[0] * scale, contact_xy_full[1] * scale)
        grays = raw_grays if args.no_stabilize else stabilize_frames(raw_grays)
        backgrounds = temporal_backgrounds(grays)
        residuals = residuals_from_backgrounds(grays, backgrounds)
        candidates_by_frame = [
            component_candidates(grays[idx], residuals[idx], backgrounds[idx], idx, contact_xy)
            for idx in range(len(grays))
        ]
        priors_by_frame = marker_priors(package, args.fps, scale)
        guided = manual_line_hypothesis(residuals, candidates_by_frame, contact_xy, priors_by_frame)
        if guided and int(guided.get("support_frames") or 0) >= 4:
            top = [guided]
        else:
            trajectories = generate_trajectories(contact_xy, len(grays), priors_by_frame)
            top = score_trajectories(trajectories, residuals, candidates_by_frame, contact_xy, priors_by_frame)
            if guided:
                top = sorted([guided, *top], key=lambda row: row["score"], reverse=True)[:20]
        marked = marker_hypothesis(residuals, candidates_by_frame, contact_xy, priors_by_frame)
        has_guided_fast_path = bool(top) and top[0].get("source") == "manual_line_guided_fast_path"
        if marked and not has_guided_fast_path:
            top = sorted([marked, *top], key=lambda row: row["score"], reverse=True)[:20]
        output = {
            "method": "spatiotemporal_trajectory_inference_v1",
            "video": str(args.video),
            "fps": args.fps,
            "duration_s": args.duration,
            "scale": scale,
            "contact_xy": {"x": contact_xy_full[0], "y": contact_xy_full[1]},
            "marker_prior_frames": sorted(priors_by_frame.keys()),
            "candidate_counts": [len(rows) for rows in candidates_by_frame],
            "top": top,
        }
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(output, indent=2), encoding="utf-8")
        draw_debug(frame_paths, top, candidates_by_frame, scale, args.debug)
        if top:
            draw_choice_debug(frame_paths, top[0], candidates_by_frame, scale, args.choice_debug)
            package_output = trajectory_observations(package, top[0], args.fps, scale)
            args.package_out.parent.mkdir(parents=True, exist_ok=True)
            args.package_out.write_text(json.dumps(package_output, indent=2), encoding="utf-8")

    print(f"Wrote {args.out}")
    print(f"Wrote {args.debug}")
    print(f"Wrote {args.choice_debug}")
    print(f"Wrote {args.package_out}")
    for idx, hyp in enumerate(top[:5], start=1):
        first = hyp["evidence"][0] if hyp["evidence"] else {}
        print(f"#{idx} score={hyp['score']:.1f} support={hyp['support_frames']} missing={hyp['missing_frames']} first=({first.get('x', 0):.1f},{first.get('y', 0):.1f})")


if __name__ == "__main__":
    main()
