"""Generate synthetic image observations through a rough camera prior."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sqlite3

import numpy as np

from camera_projection import camera_from_field_markers, project_points


def load_package(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def observation_times(package: dict) -> list[float]:
    return [
        float(row["relative_time_s"])
        for row in package.get("ball_observations", [])
        if row.get("image_x") is not None and row.get("image_y") is not None
    ]


def interpolate_trajectory(conn: sqlite3.Connection, hit_id: str, times: list[float]) -> np.ndarray:
    rows = conn.execute(
        """
        SELECT relative_time_s, x_ft, y_ft, z_ft
        FROM trajectory_points
        WHERE hit_id = ?
        ORDER BY relative_time_s
        """,
        (hit_id,),
    ).fetchall()
    traj_t = np.array([row[0] for row in rows], dtype=float)
    xyz = np.array([[row[1], row[2], row[3]] for row in rows], dtype=float)
    times_array = np.array(times, dtype=float)
    return np.column_stack(
        [
            np.interp(times_array, traj_t, xyz[:, 0]),
            np.interp(times_array, traj_t, xyz[:, 1]),
            np.interp(times_array, traj_t, xyz[:, 2]),
        ]
    )


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        DROP TABLE IF EXISTS synthetic_projected_observations;
        DROP TABLE IF EXISTS synthetic_cameras;

        CREATE TABLE synthetic_cameras (
            camera_id TEXT PRIMARY KEY,
            source_observation_package TEXT NOT NULL,
            position_x_ft REAL NOT NULL,
            position_y_ft REAL NOT NULL,
            position_z_ft REAL NOT NULL,
            target_x_ft REAL NOT NULL,
            target_y_ft REAL NOT NULL,
            target_z_ft REAL NOT NULL,
            image_width_px INTEGER NOT NULL,
            image_height_px INTEGER NOT NULL,
            horizontal_fov_deg REAL NOT NULL,
            note TEXT
        );

        CREATE TABLE synthetic_projected_observations (
            camera_id TEXT NOT NULL,
            hit_id TEXT NOT NULL,
            relative_time_s REAL NOT NULL,
            projected_x_px REAL NOT NULL,
            projected_y_px REAL NOT NULL,
            visible INTEGER NOT NULL,
            FOREIGN KEY(camera_id) REFERENCES synthetic_cameras(camera_id),
            FOREIGN KEY(hit_id) REFERENCES synthetic_hits(hit_id)
        );

        CREATE INDEX idx_projected_observations_hit_time
            ON synthetic_projected_observations(hit_id, relative_time_s);
        """
    )


def generate(package_path: Path, db_path: Path, camera_id: str) -> None:
    package = load_package(package_path)
    times = observation_times(package)
    if not times:
        raise ValueError("Observation package has no visible ball observations.")

    video = package["video_metadata"]
    camera_marker = package["camera"].get("field_marker_percent", {"x": 50, "y": 95})
    camera_height_ft = float(package["camera"].get("height_ft") or 12.0)
    camera = camera_from_field_markers(
        camera_marker,
        image_width_px=int(video["width_px"]),
        image_height_px=int(video["height_px"]),
        camera_height_ft=camera_height_ft,
    )

    with sqlite3.connect(db_path) as conn:
        create_schema(conn)
        conn.execute(
            """
            INSERT INTO synthetic_cameras (
                camera_id, source_observation_package,
                position_x_ft, position_y_ft, position_z_ft,
                target_x_ft, target_y_ft, target_z_ft,
                image_width_px, image_height_px, horizontal_fov_deg, note
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                camera_id,
                str(package_path),
                float(camera.position_ft[0]),
                float(camera.position_ft[1]),
                float(camera.position_ft[2]),
                float(camera.target_ft[0]),
                float(camera.target_ft[1]),
                float(camera.target_ft[2]),
                camera.image_width_px,
                camera.image_height_px,
                camera.horizontal_fov_deg,
                "Rough camera prior from field marker. Not landmark-calibrated.",
            ),
        )

        hit_ids = [row[0] for row in conn.execute("SELECT hit_id FROM synthetic_hits ORDER BY hit_id")]
        rows = []
        for hit_id in hit_ids:
            xyz = interpolate_trajectory(conn, hit_id, times)
            uv, visible = project_points(camera, xyz)
            rows.extend(
                (
                    camera_id,
                    hit_id,
                    float(t),
                    float(point[0]),
                    float(point[1]),
                    1 if bool(is_visible) else 0,
                )
                for t, point, is_visible in zip(times, uv, visible)
            )

        conn.executemany(
            """
            INSERT INTO synthetic_projected_observations (
                camera_id, hit_id, relative_time_s, projected_x_px, projected_y_px, visible
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        conn.commit()

    print(f"Stored camera {camera_id}")
    print(f"Camera position ft: {camera.position_ft.tolist()}")
    print(f"Camera target ft: {camera.target_ft.tolist()}")
    print(f"Stored {len(rows)} projected observations")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("observation_package", type=Path)
    parser.add_argument("--db", default=Path("data/hittrax_from_video.sqlite"), type=Path)
    parser.add_argument("--camera-id", default="sample_video_camera_prior")
    args = parser.parse_args()
    generate(args.observation_package, args.db, args.camera_id)


if __name__ == "__main__":
    main()
