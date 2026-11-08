from __future__ import annotations

import argparse
import concurrent.futures
import copy
import csv
import json
from pathlib import Path
import subprocess
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CODEX_PYTHON = Path.home() / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "python" / "python.exe"


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def set_nested(package: dict[str, Any], path: list[str], value: Any) -> None:
    target = package
    for key in path[:-1]:
        target = target.setdefault(key, {})
    target[path[-1]] = value


def marker_distance_ft(package: dict[str, Any]) -> float | None:
    marker = (((package.get("hit") or {}).get("distance_observation") or {}).get("field_marker_percent") or {})
    try:
        marker_x = float(marker["x"]) * 3.6
        marker_y = float(marker["y"]) * 4.2
    except Exception:
        return None
    dx = marker_x - 180.0
    dy = 316.0 - marker_y
    return ((dx * dx + dy * dy) ** 0.5) * (400.0 / 234.0)


def apply_endpoint_distance_estimate(package: dict[str, Any]) -> None:
    distance_obs = package.setdefault("hit", {}).setdefault("distance_observation", {})
    if distance_obs.get("distance_ft") not in (None, ""):
        return
    marker_distance = marker_distance_ft(package)
    if marker_distance is None:
        return
    distance_obs["distance_ft"] = round(marker_distance)
    distance_obs["uncertainty_ft"] = float(distance_obs.get("uncertainty_ft") or 60.0)
    distance_obs["source"] = "FIELD_ENDPOINT_MARKER"


def mutate(base: dict[str, Any], variant: str) -> dict[str, Any]:
    package = copy.deepcopy(base)
    camera = package.setdefault("camera", {}).setdefault("field_marker_percent", {})
    landing = package.setdefault("hit", {}).setdefault("distance_observation", {}).setdefault("field_marker_percent", {})
    distance_obs = package.setdefault("hit", {}).setdefault("distance_observation", {})
    terminal = package.get("terminal_event")
    if variant == "baseline":
        pass
    elif variant == "camera_left_5pct":
        camera["x"] = float(camera.get("x") or 50.0) - 5.0
    elif variant == "camera_right_5pct":
        camera["x"] = float(camera.get("x") or 50.0) + 5.0
    elif variant == "camera_back_5pct":
        camera["y"] = float(camera.get("y") or 80.0) + 5.0
    elif variant == "camera_forward_5pct":
        camera["y"] = float(camera.get("y") or 80.0) - 5.0
    elif variant == "camera_height_plus_4ft":
        package.setdefault("camera", {})["height_ft"] = float(package.get("camera", {}).get("height_ft") or 6.0) + 4.0
    elif variant == "landing_marker_shorter_5pct":
        landing["y"] = float(landing.get("y") or 35.0) + 5.0
    elif variant == "landing_marker_deeper_5pct":
        landing["y"] = float(landing.get("y") or 35.0) - 5.0
    elif variant == "numeric_distance_minus_25ft":
        marker_distance = marker_distance_ft(package)
        if marker_distance is not None:
            distance_obs["distance_ft"] = max(0.0, marker_distance - 25.0)
            distance_obs["uncertainty_ft"] = 15.0
            distance_obs["source"] = "HUMAN_NUMERIC_DISTANCE"
    elif variant == "numeric_distance_plus_25ft":
        marker_distance = marker_distance_ft(package)
        if marker_distance is not None:
            distance_obs["distance_ft"] = marker_distance + 25.0
            distance_obs["uncertainty_ft"] = 15.0
            distance_obs["source"] = "HUMAN_NUMERIC_DISTANCE"
    elif variant == "ground_contact_early_0p20s" and terminal:
        terminal["relative_time_s"] = float(terminal.get("relative_time_s") or 0.0) - 0.20
        if terminal.get("video_time_s") is not None:
            terminal["video_time_s"] = float(terminal["video_time_s"]) - 0.20
    elif variant == "ground_contact_late_0p20s" and terminal:
        terminal["relative_time_s"] = float(terminal.get("relative_time_s") or 0.0) + 0.20
        if terminal.get("video_time_s") is not None:
            terminal["video_time_s"] = float(terminal["video_time_s"]) + 0.20
    elif variant == "ground_contact_removed":
        package["terminal_event"] = None
    else:
        raise ValueError(f"unknown variant: {variant}")
    apply_endpoint_distance_estimate(package)
    return package


def summarize_prediction(case_name: str, json_name: str, variant: str, package_path: Path, output_path: Path, completed: subprocess.CompletedProcess[str]) -> dict[str, Any]:
    if completed.returncode != 0:
        return {
            "case": case_name,
            "json": json_name,
            "variant": variant,
            "ok": False,
            "error": (completed.stderr or completed.stdout or "")[-1000:],
        }
    pred = load_json(output_path)
    rows = pred.get("ev_candidates") or []
    best = rows[0] if rows else {}
    top5 = rows[:5]
    def avg(key: str) -> float | None:
        vals = [float(row[key]) for row in top5 if row.get(key) is not None]
        return sum(vals) / len(vals) if vals else None
    pkg = load_json(package_path)
    return {
        "case": case_name,
        "json": json_name,
        "variant": variant,
        "ok": True,
        "direct_la_deg": (pred.get("direct_launch_angle") or {}).get("launch_angle_deg"),
        "spray_deg": (pred.get("field_direction") or {}).get("spray_angle_deg"),
        "marker_distance_ft": (pred.get("field_direction") or {}).get("estimated_distance_ft"),
        "ground_rel_s": ((pkg.get("terminal_event") or {}).get("relative_time_s")),
        "best_hit_id": best.get("hit_id"),
        "best_ev_mph": best.get("exit_velocity_mph"),
        "best_la_deg": best.get("launch_angle_deg"),
        "best_distance_ft": best.get("distance_ft"),
        "best_hang_s": best.get("hang_time_s"),
        "best_score": best.get("score"),
        "top5_ev_mph": avg("exit_velocity_mph"),
        "top5_la_deg": avg("launch_angle_deg"),
        "top5_distance_ft": avg("distance_ft"),
        "top5_hang_s": avg("hang_time_s"),
    }


def run_one(args: tuple[str, Path, str, Path, Path, Path, Path]) -> dict[str, Any]:
    case_name, source_json, variant, work_dir, db_path, python_exe, estimator = args
    base = load_json(source_json)
    package = mutate(base, variant)
    case_dir = work_dir / case_name.replace(" ", "_")
    case_dir.mkdir(parents=True, exist_ok=True)
    package_path = case_dir / f"{variant}.json"
    output_path = case_dir / f"{variant}_prediction.json"
    package_path.write_text(json.dumps(package, indent=2), encoding="utf-8")
    completed = subprocess.run(
        [
            str(python_exe),
            str(estimator),
            str(package_path),
            "--db",
            str(db_path),
            "--out",
            str(output_path),
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        timeout=180,
        check=False,
    )
    return summarize_prediction(case_name, source_json.name, variant, package_path, output_path, completed)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=ROOT / "comparison_output" / "live" / "sensitivity_results.csv", type=Path)
    parser.add_argument("--workers", default=6, type=int)
    args = parser.parse_args()
    python_exe = CODEX_PYTHON if CODEX_PYTHON.exists() else Path(sys.executable)
    db_path = ROOT / "data" / "hittrax_from_video.sqlite"
    estimator = ROOT / "synthetic" / "direct_video_estimate.py"
    work_dir = ROOT / "comparison_output" / "sensitivity"
    cases = {
        "cortland_night": Path.home() / "Downloads" / "cortland.json",
        "cortland_consolidation_turf": Path.home() / "Downloads" / "cortland consolation.json",
        "hilton_grass": Path.home() / "Downloads" / "hilton.json",
    }
    variants = [
        "baseline",
        "camera_left_5pct",
        "camera_right_5pct",
        "camera_back_5pct",
        "camera_forward_5pct",
        "camera_height_plus_4ft",
        "landing_marker_shorter_5pct",
        "landing_marker_deeper_5pct",
        "numeric_distance_minus_25ft",
        "numeric_distance_plus_25ft",
        "ground_contact_early_0p20s",
        "ground_contact_late_0p20s",
        "ground_contact_removed",
    ]
    jobs = [
        (case_name, source_json, variant, work_dir, db_path, python_exe, estimator)
        for case_name, source_json in cases.items()
        for variant in variants
    ]
    rows: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        for row in pool.map(run_one, jobs):
            rows.append(row)
            print(f"{row['case']:<30} {row['variant']:<30} {'ok' if row.get('ok') else 'ERR'}", flush=True)
    fieldnames = [
        "case", "json", "variant", "ok", "direct_la_deg", "spray_deg", "marker_distance_ft", "ground_rel_s",
        "best_hit_id", "best_ev_mph", "best_la_deg", "best_distance_ft", "best_hang_s", "best_score",
        "top5_ev_mph", "top5_la_deg", "top5_distance_ft", "top5_hang_s", "error",
    ]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key) for key in fieldnames})
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
