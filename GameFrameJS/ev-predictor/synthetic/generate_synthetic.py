"""Generate Baseball Flight Sim-compatible synthetic trajectory data."""

from __future__ import annotations

import argparse
import csv
from dataclasses import asdict
import json
import math
from pathlib import Path

from baseball_flight import Ball, Environment, Hit, StartPosition, simulate_trajectory


def build_cases():
    """Every supported speed/launch/spray combination, with no special grids."""
    from uniform_grid import cases
    for ev, la, spray in cases():
        yield {
            "hit_id": f"g_{ev}_{la}_{spray}",
            "exit_velocity_mph": float(ev), "launch_angle_deg": float(la),
            "spray_angle_deg": float(spray), "batter_hand": "R", "estimate_spin": True,
            "note": "Complete uniform grid; default environment and estimated spin",
        }


def write_outputs(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    env = Environment()
    ball = Ball()
    start = StartPosition()
    cases = build_cases()

    truth_path = output_dir / "synthetic_truth.csv"
    trajectory_path = output_dir / "synthetic_trajectories.csv"
    metadata_path = output_dir / "synthetic_metadata.json"

    truth_fields = [
        "hit_id",
        "exit_velocity_mph",
        "launch_angle_deg",
        "spray_angle_deg",
        "batter_hand",
        "estimate_spin",
        "note",
        "backspin_rpm",
        "sidespin_rpm",
        "spin_rpm",
        "distance_ft",
        "hang_time_s",
        "apex_ft",
        "apex_time_s",
        "landing_x_ft",
        "landing_y_ft",
        "landing_spray_angle_deg",
        "bfs_display_angle_deg",
    ]
    trajectory_fields = [
        "hit_id",
        "relative_time_s",
        "x_ft",
        "y_ft",
        "z_ft",
        "vx_ft_s",
        "vy_ft_s",
        "vz_ft_s",
        "speed_ft_s",
        "distance_ft",
        "height_ft",
    ]
    truth_count = 0
    trajectory_count = 0

    with truth_path.open("w", newline="", encoding="utf-8") as f:
        truth_writer = csv.DictWriter(f, fieldnames=truth_fields)
        truth_writer.writeheader()
        with trajectory_path.open("w", newline="", encoding="utf-8") as traj_file:
            trajectory_writer = csv.DictWriter(traj_file, fieldnames=trajectory_fields)
            trajectory_writer.writeheader()

            for case in cases:
                hit = Hit(
                    exit_velocity_mph=case["exit_velocity_mph"],
                    launch_angle_deg=case["launch_angle_deg"],
                    spray_angle_deg=case["spray_angle_deg"],
                    batter_hand=case["batter_hand"],
                    estimate_spin=case["estimate_spin"],
                )
                traj = simulate_trajectory(hit, env, ball, start)

                truth_writer.writerow(
                    {
                        **case,
                        "backspin_rpm": round(traj.backspin_rpm, 3),
                        "sidespin_rpm": round(traj.sidespin_rpm, 3),
                        "spin_rpm": round(traj.spin_rpm, 3),
                        "distance_ft": round(traj.distance_ft, 3),
                        "hang_time_s": round(traj.hang_time_s, 3),
                        "apex_ft": round(traj.apex_ft, 3),
                        "apex_time_s": round(traj.apex_time_s, 3),
                        "landing_x_ft": round(traj.landing_x_ft, 3),
                        "landing_y_ft": round(traj.landing_y_ft, 3),
                        "landing_spray_angle_deg": math.degrees(math.atan2(traj.landing_x_ft, traj.landing_y_ft)),
                        "bfs_display_angle_deg": traj.bfs_display_angle_deg,
                    }
                )
                truth_count += 1

                for point_index, point in enumerate(traj.points):
                    if point_index % 3 != 0 and point_index != len(traj.points) - 1:
                        continue
                    trajectory_writer.writerow(
                        {
                            "hit_id": case["hit_id"],
                            "relative_time_s": round(point.t_s, 6),
                            "x_ft": round(point.x_ft, 6),
                            "y_ft": round(point.y_ft, 6),
                            "z_ft": round(point.z_ft, 6),
                            "vx_ft_s": round(point.vx_ft_s, 6),
                            "vy_ft_s": round(point.vy_ft_s, 6),
                            "vz_ft_s": round(point.vz_ft_s, 6),
                            "speed_ft_s": round(point.speed_ft_s, 6),
                            "distance_ft": round(point.distance_ft, 6),
                            "height_ft": round(point.height_ft, 6),
                        }
                    )
                    trajectory_count += 1

    metadata = {
        "schema_version": "0.1-research",
        "model": "Baseball Flight Sim compatible Python port",
        "source_reference": "https://www.baseballflightsim.com/",
        "environment": asdict(env),
        "ball": asdict(ball),
        "start_position": asdict(start),
        "time_step_s": 0.01,
        "outputs": {
            "truth_csv": truth_path.name,
            "trajectories_csv": trajectory_path.name,
        },
    }
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print(f"Wrote {truth_count} truth rows to {truth_path}")
    print(f"Wrote {trajectory_count} trajectory rows to {trajectory_path}")
    print(f"Wrote metadata to {metadata_path}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="synthetic_output", type=Path)
    args = parser.parse_args()
    write_outputs(args.output_dir)


if __name__ == "__main__":
    main()
