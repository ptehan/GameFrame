import argparse
import json
import math
import sys
from pathlib import Path


def emit(payload):
    sys.stdout.write(json.dumps(payload, separators=(",", ":")))


def clamp(value, lo, hi):
    return max(lo, min(hi, value))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--start", type=int, required=True)
    parser.add_argument("--end", type=int, required=True)
    parser.add_argument("--fps", type=float, default=30.0)
    parser.add_argument("--model", default="yolo11n.pt")
    parser.add_argument("--conf", type=float, default=0.02)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--crop-x", type=float, default=None)
    parser.add_argument("--crop-y", type=float, default=None)
    parser.add_argument("--crop-w", type=float, default=None)
    parser.add_argument("--crop-h", type=float, default=None)
    args = parser.parse_args()

    try:
        import cv2
        from ultralytics import YOLO
    except Exception as exc:
        emit({
            "ok": False,
            "error": f"YOLO dependencies are not available: {exc}",
            "detections": [],
            "tracks": [],
        })
        return 0

    video_path = Path(args.video)
    if not video_path.exists():
        emit({"ok": False, "error": "video file not found", "detections": [], "tracks": []})
        return 0

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        emit({"ok": False, "error": "could not open video", "detections": [], "tracks": []})
        return 0

    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    fps = float(args.fps or cap.get(cv2.CAP_PROP_FPS) or 30.0)
    start = clamp(int(args.start), 0, max(0, frame_count - 1))
    end = clamp(int(args.end), start, max(start, frame_count - 1))

    try:
        model = YOLO(args.model)
    except Exception as exc:
        emit({
            "ok": False,
            "error": f"could not load YOLO model {args.model}: {exc}",
            "detections": [],
            "tracks": [],
        })
        return 0

    names = getattr(model, "names", {}) or {}
    sports_ball_ids = {
        int(k) for k, v in names.items()
        if str(v).lower().replace("_", " ") in {"sports ball", "baseball", "ball"}
    }
    if not sports_ball_ids:
        sports_ball_ids = {32}

    crop = None
    if all(v is not None for v in [args.crop_x, args.crop_y, args.crop_w, args.crop_h]):
        crop = {
            "x": clamp(float(args.crop_x), 0.0, 1.0),
            "y": clamp(float(args.crop_y), 0.0, 1.0),
            "w": clamp(float(args.crop_w), 0.05, 1.0),
            "h": clamp(float(args.crop_h), 0.05, 1.0),
        }

    frame_images = []
    frame_offsets = []
    frame_numbers = []
    cap.set(cv2.CAP_PROP_POS_FRAMES, start)
    for frame in range(start, end + 1):
        ok, image = cap.read()
        if not ok:
            break
        off_x = 0
        off_y = 0
        if crop:
            ih, iw = image.shape[:2]
            x1 = int(clamp(crop["x"], 0, 0.98) * iw)
            y1 = int(clamp(crop["y"], 0, 0.98) * ih)
            x2 = int(clamp(crop["x"] + crop["w"], 0.02, 1.0) * iw)
            y2 = int(clamp(crop["y"] + crop["h"], 0.02, 1.0) * ih)
            if x2 > x1 + 8 and y2 > y1 + 8:
                image = image[y1:y2, x1:x2]
                off_x = x1
                off_y = y1
        frame_images.append(image)
        frame_offsets.append((off_x, off_y))
        frame_numbers.append(frame)
    cap.release()

    detections = []
    if frame_images:
        results = model.predict(
            source=frame_images,
            conf=args.conf,
            imgsz=args.imgsz,
            verbose=False,
            classes=list(sports_ball_ids),
        )
    else:
        results = []

    for frame, result, offset in zip(frame_numbers, results, frame_offsets):
        off_x, off_y = offset
        boxes = getattr(result, "boxes", None)
        if boxes is None or len(boxes) == 0:
            continue
        for box in boxes:
            xyxy = box.xyxy[0].detach().cpu().numpy().tolist()
            conf = float(box.conf[0].detach().cpu().item()) if box.conf is not None else 0.0
            cls = int(box.cls[0].detach().cpu().item()) if box.cls is not None else -1
            x1, y1, x2, y2 = [float(v) for v in xyxy]
            x1 += off_x
            x2 += off_x
            y1 += off_y
            y2 += off_y
            w = max(0.0, x2 - x1)
            h = max(0.0, y2 - y1)
            if w <= 0 or h <= 0:
                continue
            detections.append({
                "frame": frame,
                "time": frame / fps,
                "score": conf,
                "classId": cls,
                "className": str(names.get(cls, "sports ball")),
                "x": (x1 + x2) * 0.5,
                "y": (y1 + y2) * 0.5,
                "w": w,
                "h": h,
                "xyxy": [x1, y1, x2, y2],
            })

    by_frame = {}
    for det in detections:
        cur = by_frame.get(det["frame"])
        if cur is None or det["score"] > cur["score"]:
            by_frame[det["frame"]] = det
    ordered = [by_frame[k] for k in sorted(by_frame)]
    tracks = []
    for det in ordered:
        path = [det]
        last = det
        for other in ordered:
            if other["frame"] <= last["frame"] or other["frame"] > last["frame"] + 6:
                continue
            dist = math.hypot(other["x"] - last["x"], other["y"] - last["y"])
            max_dist = 220 + 25 * (other["frame"] - last["frame"])
            if dist <= max_dist:
                path.append(other)
                last = other
        if len(path) >= 2:
            tracks.append({
                "startFrame": path[0]["frame"],
                "endFrame": path[-1]["frame"],
                "frames": [p["frame"] for p in path],
                "points": path,
                "score": sum(p["score"] for p in path) / len(path) + min(0.25, len(path) * 0.04),
            })
    tracks.sort(key=lambda t: (-len(t["points"]), -t["score"], t["startFrame"]))
    best = tracks[0] if tracks else None
    release_frame = None
    if best:
        release_frame = max(0, int(best["startFrame"]) - 1)

    emit({
        "ok": True,
        "model": args.model,
        "fps": fps,
        "window": {"start": start, "end": end},
        "detections": ordered[:50],
        "tracks": tracks[:10],
        "best": best,
        "frame": int(best["startFrame"]) if best else None,
        "releaseFrame": release_frame,
        "releaseOffset": 1,
        "score": float(best["score"]) if best else 0.0,
        "trackType": "yolo_sports_ball",
        "accepted": best is not None,
        "reason": "YOLO sports-ball track" if best else "no supported YOLO sports-ball track",
    })
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
