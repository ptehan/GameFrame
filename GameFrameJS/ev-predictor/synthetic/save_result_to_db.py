"""Save a tagged hit package, prediction result, and optional contact clip to SQLite."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
from typing import Any


def load_json(path: Path | None) -> dict[str, Any] | None:
    if path is None or not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def locate_video(file_name: str | None, explicit: Path | None) -> Path | None:
    if explicit and explicit.exists():
        return explicit
    if not file_name:
        return None
    candidates = [
        Path.cwd() / file_name,
        Path.cwd() / "clips" / file_name,
        Path.home() / "Downloads" / file_name,
        Path.home() / "Videos" / file_name,
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def ensure_column(conn: sqlite3.Connection, table: str, name: str, ddl: str) -> None:
    columns = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    if name not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")


def create_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS saved_hit_results (
            result_id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            source_file_name TEXT,
            source_video_path TEXT,
            observation_package_path TEXT,
            prediction_path TEXT,
            contact_time_s REAL,
            clip_id TEXT,
            direct_launch_angle_deg REAL,
            apex_time_s REAL,
            apex_height_ft REAL,
            apex_exit_velocity_mph REAL,
            apex_launch_angle_deg REAL,
            actual_exit_velocity_mph REAL,
            actual_launch_angle_deg REAL,
            actual_distance_ft REAL,
            best_hit_id TEXT,
            best_exit_velocity_mph REAL,
            best_launch_angle_deg REAL,
            best_distance_ft REAL,
            best_hang_time_s REAL,
            view_classification TEXT,
            observation_package_json TEXT NOT NULL,
            prediction_json TEXT,
            note TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS video_clips (
            clip_id TEXT PRIMARY KEY,
            result_id TEXT,
            source_video_path TEXT NOT NULL,
            source_file_name TEXT NOT NULL,
            clip_path TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            start_time_s REAL NOT NULL,
            contact_time_s REAL NOT NULL,
            end_time_s REAL NOT NULL,
            duration_s REAL NOT NULL,
            pre_contact_s REAL NOT NULL,
            post_contact_s REAL NOT NULL,
            width_px INTEGER,
            height_px INTEGER,
            observation_package_json TEXT,
            sha256 TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            clip_blob BLOB NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            note TEXT
        )
        """
    )
    ensure_column(conn, "video_clips", "result_id", "TEXT")


def ffprobe_duration(path: Path) -> float:
    output = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
        text=True,
    )
    return float(json.loads(output)["format"]["duration"])


def make_clip(
    video_path: Path,
    output_dir: Path,
    clip_id: str,
    contact_time_s: float,
    pre_s: float,
    post_s: float,
) -> tuple[Path, float, float, float]:
    output_dir.mkdir(parents=True, exist_ok=True)
    start_s = max(0.0, contact_time_s - pre_s)
    end_s = contact_time_s + post_s
    duration_s = end_s - start_s
    clip_path = output_dir / f"{clip_id}.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-ss",
            f"{start_s:.6f}",
            "-i",
            str(video_path),
            "-t",
            f"{duration_s:.6f}",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "18",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-movflags",
            "+faststart",
            str(clip_path),
        ],
        check=True,
    )
    return clip_path, start_s, end_s, ffprobe_duration(clip_path)


def result_fields(prediction: dict[str, Any] | None) -> dict[str, Any]:
    prediction = prediction or {}
    best = (prediction.get("ev_candidates") or [{}])[0]
    apex_launch = prediction.get("apex_ballistic_launch_estimate") or {}
    apex_physics = prediction.get("apex_physics_estimate") or {}
    return {
        "direct_launch_angle_deg": (prediction.get("direct_launch_angle") or {}).get("launch_angle_deg"),
        "apex_time_s": apex_launch.get("apex_time_s") or apex_physics.get("apex_time_s"),
        "apex_height_ft": apex_launch.get("apex_height_ft") or apex_physics.get("apex_height_ft"),
        "apex_exit_velocity_mph": apex_launch.get("exit_velocity_mph"),
        "apex_launch_angle_deg": apex_launch.get("launch_angle_deg"),
        "best_hit_id": best.get("hit_id"),
        "best_exit_velocity_mph": best.get("exit_velocity_mph"),
        "best_launch_angle_deg": best.get("launch_angle_deg"),
        "best_distance_ft": best.get("distance_ft"),
        "best_hang_time_s": best.get("hang_time_s"),
        "view_classification": (prediction.get("view_geometry") or {}).get("classification"),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", required=True, type=Path, help="Observation package JSON.")
    parser.add_argument("--prediction", default=Path("comparison_output/direct_video_estimate.json"), type=Path)
    parser.add_argument("--video", type=Path, help="Source video. If omitted, try package video_metadata.file_name.")
    parser.add_argument("--db", default=Path("data/hittrax_from_video.sqlite"), type=Path)
    parser.add_argument("--clip-dir", default=Path("clips"), type=Path)
    parser.add_argument("--pre", default=1.0, type=float)
    parser.add_argument("--post", default=6.0, type=float)
    parser.add_argument("--actual-exit-velocity", type=float)
    parser.add_argument("--actual-launch-angle", type=float)
    parser.add_argument("--actual-distance", type=float)
    parser.add_argument("--note", default="")
    args = parser.parse_args()

    package = load_json(args.package)
    if package is None:
        raise FileNotFoundError(args.package)
    prediction = load_json(args.prediction)
    metadata = package.get("video_metadata") or {}
    contact_time_s = float((package.get("hit") or {}).get("contact", {}).get("timestamp_s"))
    source_file_name = metadata.get("file_name")
    video_path = locate_video(source_file_name, args.video)

    package_json = json.dumps(package, separators=(",", ":"))
    prediction_json = None if prediction is None else json.dumps(prediction, separators=(",", ":"))
    fingerprint = hashlib.sha1((package_json + (prediction_json or "")).encode("utf-8")).hexdigest()[:10]
    base_name = Path(source_file_name or args.package.stem).stem
    result_id = f"{base_name}_contact_{contact_time_s:.6f}_{fingerprint}"
    clip_id = f"{result_id}_clip"

    clip_path = None
    clip_blob = None
    clip_sha = None
    clip_size = None
    start_s = max(0.0, contact_time_s - args.pre)
    end_s = contact_time_s + args.post
    encoded_duration_s = end_s - start_s
    if video_path is not None:
        clip_path, start_s, end_s, encoded_duration_s = make_clip(
            video_path,
            args.clip_dir,
            clip_id,
            contact_time_s,
            args.pre,
            args.post,
        )
        clip_blob = clip_path.read_bytes()
        clip_sha = hashlib.sha256(clip_blob).hexdigest()
        clip_size = len(clip_blob)

    fields = result_fields(prediction)
    with sqlite3.connect(args.db) as conn:
        create_schema(conn)
        ensure_column(conn, "saved_hit_results", "actual_exit_velocity_mph", "REAL")
        ensure_column(conn, "saved_hit_results", "actual_launch_angle_deg", "REAL")
        ensure_column(conn, "saved_hit_results", "actual_distance_ft", "REAL")
        if clip_blob is not None and clip_path is not None and video_path is not None:
            conn.execute(
                """
                INSERT OR REPLACE INTO video_clips (
                    clip_id, result_id, source_video_path, source_file_name, clip_path, mime_type,
                    start_time_s, contact_time_s, end_time_s, duration_s, pre_contact_s, post_contact_s,
                    width_px, height_px, observation_package_json, sha256, size_bytes, clip_blob, note
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    clip_id,
                    result_id,
                    str(video_path),
                    video_path.name,
                    str(clip_path),
                    "video/mp4",
                    start_s,
                    contact_time_s,
                    end_s,
                    encoded_duration_s,
                    args.pre,
                    args.post,
                    metadata.get("width_px"),
                    metadata.get("height_px"),
                    package_json,
                    clip_sha,
                    clip_size,
                    sqlite3.Binary(clip_blob),
                    args.note or "Saved with hit result parameters.",
                ),
            )
        conn.execute(
            """
            INSERT OR REPLACE INTO saved_hit_results (
                result_id, source_file_name, source_video_path, observation_package_path, prediction_path,
                contact_time_s, clip_id, direct_launch_angle_deg, apex_time_s, apex_height_ft,
                apex_exit_velocity_mph, apex_launch_angle_deg, actual_exit_velocity_mph,
                actual_launch_angle_deg, actual_distance_ft, best_hit_id, best_exit_velocity_mph,
                best_launch_angle_deg, best_distance_ft, best_hang_time_s, view_classification,
                observation_package_json, prediction_json, note
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                result_id,
                source_file_name,
                None if video_path is None else str(video_path),
                str(args.package),
                None if prediction is None else str(args.prediction),
                contact_time_s,
                clip_id if clip_blob is not None else None,
                fields["direct_launch_angle_deg"],
                fields["apex_time_s"],
                fields["apex_height_ft"],
                fields["apex_exit_velocity_mph"],
                fields["apex_launch_angle_deg"],
                args.actual_exit_velocity,
                args.actual_launch_angle,
                args.actual_distance,
                fields["best_hit_id"],
                fields["best_exit_velocity_mph"],
                fields["best_launch_angle_deg"],
                fields["best_distance_ft"],
                fields["best_hang_time_s"],
                fields["view_classification"],
                package_json,
                prediction_json,
                args.note,
            ),
        )

    print(f"Saved result_id={result_id}")
    if clip_blob is None:
        print("Saved parameters only; no source video found/provided.")
    else:
        print(f"Saved clip_id={clip_id} size={clip_size} sha256={clip_sha}")


if __name__ == "__main__":
    main()
