"""Append lower-EV small-field synthetic trajectories to the SQLite database."""

from __future__ import annotations

import argparse
from pathlib import Path
import sqlite3

from baseball_flight import Ball, Environment, Hit, StartPosition, simulate_trajectory


def append_rows(db_path: Path) -> tuple[int, int]:
    env = Environment()
    ball = Ball()
    start = StartPosition()
    hit_rows = 0
    point_rows = 0

    with sqlite3.connect(db_path) as conn:
        if conn.execute("SELECT 1 FROM sqlite_master WHERE name='generation_manifest'").fetchone():
            raise ValueError('This database is a complete uniform grid. Rebuild it; do not append a separate small-field grid.')
        for ev in range(52, 67):
            for la in range(24, 37):
                for spray in range(-35, 36, 5):
                    hit_id = f"small_ev{ev}_la{la}_spray{spray}"
                    exists = conn.execute("SELECT 1 FROM synthetic_hits WHERE hit_id=?", (hit_id,)).fetchone()
                    if exists:
                        continue
                    hit = Hit(
                        exit_velocity_mph=float(ev),
                        launch_angle_deg=float(la),
                        spray_angle_deg=float(spray),
                        batter_hand="R",
                        estimate_spin=True,
                    )
                    traj = simulate_trajectory(hit, env, ball, start)
                    conn.execute(
                        """
                        INSERT INTO synthetic_hits (
                            hit_id, exit_velocity_mph, launch_angle_deg, spray_angle_deg,
                            batter_hand, estimate_spin, note, backspin_rpm, sidespin_rpm,
                            spin_rpm, distance_ft, hang_time_s, apex_ft, apex_time_s,
                            landing_x_ft, landing_y_ft, landing_spray_angle_deg, bfs_display_angle_deg
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            hit_id,
                            float(ev),
                            float(la),
                            float(spray),
                            "R",
                            1,
                            "Small-field lower-EV extension grid",
                            round(traj.backspin_rpm, 3),
                            round(traj.sidespin_rpm, 3),
                            round(traj.spin_rpm, 3),
                            round(traj.distance_ft, 3),
                            round(traj.hang_time_s, 3),
                            round(traj.apex_ft, 3),
                            round(traj.apex_time_s, 3),
                            round(traj.landing_x_ft, 3),
                            round(traj.landing_y_ft, 3),
                            traj.landing_spray_angle_deg,
                            traj.bfs_display_angle_deg,
                        ),
                    )
                    hit_rows += 1
                    for point_index, point in enumerate(traj.points):
                        if point_index % 3 != 0 and point_index != len(traj.points) - 1:
                            continue
                        conn.execute(
                            """
                            INSERT INTO trajectory_points (
                                hit_id, relative_time_s, x_ft, y_ft, z_ft,
                                vx_ft_s, vy_ft_s, vz_ft_s, speed_ft_s,
                                distance_ft, height_ft
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                hit_id,
                                round(point.t_s, 6),
                                round(point.x_ft, 6),
                                round(point.y_ft, 6),
                                round(point.z_ft, 6),
                                round(point.vx_ft_s, 6),
                                round(point.vy_ft_s, 6),
                                round(point.vz_ft_s, 6),
                                round(point.speed_ft_s, 6),
                                round(point.distance_ft, 6),
                                round(point.height_ft, 6),
                            ),
                        )
                        point_rows += 1
                    if hit_rows % 500 == 0:
                        conn.commit()
        conn.commit()

    return hit_rows, point_rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "hittrax_from_video.sqlite")
    args = parser.parse_args()
    hit_rows, point_rows = append_rows(args.db)
    print(f"Appended {hit_rows} synthetic hits and {point_rows} trajectory points to {args.db}")


if __name__ == "__main__":
    main()
