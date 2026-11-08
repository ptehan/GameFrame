"""Load generated synthetic CSV files into a local SQLite database."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path
import sqlite3


TRUTH_COLUMNS = {
    "hit_id": "TEXT PRIMARY KEY",
    "exit_velocity_mph": "REAL NOT NULL",
    "launch_angle_deg": "REAL NOT NULL",
    "spray_angle_deg": "REAL NOT NULL",
    "batter_hand": "TEXT NOT NULL",
    "estimate_spin": "INTEGER NOT NULL",
    "note": "TEXT",
    "backspin_rpm": "REAL NOT NULL",
    "sidespin_rpm": "REAL NOT NULL",
    "spin_rpm": "REAL NOT NULL",
    "distance_ft": "REAL NOT NULL",
    "hang_time_s": "REAL NOT NULL",
    "apex_ft": "REAL NOT NULL",
    "apex_time_s": "REAL NOT NULL",
    "landing_x_ft": "REAL NOT NULL",
    "landing_y_ft": "REAL NOT NULL",
    "landing_spray_angle_deg": "REAL NOT NULL",
    "bfs_display_angle_deg": "REAL NOT NULL",
}

TRAJECTORY_COLUMNS = {
    "hit_id": "TEXT NOT NULL",
    "relative_time_s": "REAL NOT NULL",
    "x_ft": "REAL NOT NULL",
    "y_ft": "REAL NOT NULL",
    "z_ft": "REAL NOT NULL",
    "vx_ft_s": "REAL NOT NULL",
    "vy_ft_s": "REAL NOT NULL",
    "vz_ft_s": "REAL NOT NULL",
    "speed_ft_s": "REAL NOT NULL",
    "distance_ft": "REAL NOT NULL",
    "height_ft": "REAL NOT NULL",
}


def coerce_value(column: str, value: str):
    if column == "estimate_spin":
        return 1 if value.lower() == "true" else 0
    if column in {"hit_id", "batter_hand", "note"}:
        return value
    return float(value)


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        f"""
        DROP TABLE IF EXISTS comparison_candidates;
        DROP TABLE IF EXISTS comparison_runs;
        DROP TABLE IF EXISTS synthetic_projected_observations;
        DROP TABLE IF EXISTS synthetic_cameras;
        DROP TABLE IF EXISTS generation_manifest;
        DROP TABLE IF EXISTS trajectory_points;
        DROP TABLE IF EXISTS synthetic_hits;

        CREATE TABLE synthetic_hits (
            {", ".join(f"{name} {definition}" for name, definition in TRUTH_COLUMNS.items())}
        );

        CREATE TABLE trajectory_points (
            point_id INTEGER PRIMARY KEY AUTOINCREMENT,
            {", ".join(f"{name} {definition}" for name, definition in TRAJECTORY_COLUMNS.items())},
            FOREIGN KEY(hit_id) REFERENCES synthetic_hits(hit_id)
        );

        CREATE INDEX idx_synthetic_hits_ev_la
            ON synthetic_hits(exit_velocity_mph, launch_angle_deg);
        CREATE INDEX idx_synthetic_hits_distance
            ON synthetic_hits(distance_ft);
        CREATE INDEX idx_synthetic_hits_hang_time
            ON synthetic_hits(hang_time_s);
        CREATE INDEX idx_trajectory_points_hit_time
            ON trajectory_points(hit_id, relative_time_s);
        """
    )


def load_csv(conn: sqlite3.Connection, table: str, csv_path: Path, columns: dict[str, str]) -> int:
    with csv_path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        expected = list(columns)
        missing = [column for column in expected if column not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"{csv_path} is missing columns: {', '.join(missing)}")

        placeholders = ", ".join("?" for _ in expected)
        sql = f"INSERT INTO {table} ({', '.join(expected)}) VALUES ({placeholders})"
        rows = [
            tuple(coerce_value(column, row[column]) for column in expected)
            for row in reader
        ]
        conn.executemany(sql, rows)
        return len(rows)


def load_database(input_dir: Path, db_path: Path) -> None:
    truth_path = input_dir / "synthetic_truth.csv"
    trajectory_path = input_dir / "synthetic_trajectories.csv"
    if not truth_path.exists() or not trajectory_path.exists():
        raise FileNotFoundError("Run synthetic/generate_synthetic.py before loading the database.")

    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        create_schema(conn)
        truth_count = load_csv(conn, "synthetic_hits", truth_path, TRUTH_COLUMNS)
        trajectory_count = load_csv(conn, "trajectory_points", trajectory_path, TRAJECTORY_COLUMNS)
        conn.commit()

    print(f"Loaded {truth_count} synthetic hits")
    print(f"Loaded {trajectory_count} trajectory points")
    print(f"Database: {db_path}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", default="synthetic_output", type=Path)
    parser.add_argument("--db", default="data/hittrax_from_video.sqlite", type=Path)
    args = parser.parse_args()
    load_database(args.input_dir, args.db)


if __name__ == "__main__":
    main()
