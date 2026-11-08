"""Conservative consistency checks against user-marked early flight anchors."""
import math

AUTO_SOURCES = {'COMPUTER_VISION', 'PATH_SEARCH', 'BRUSH_PATH_SEARCH'}


def reject_early_anchor_arrivals(observations, frame_step_s=1 / 30, anchors=None):
    def point(row):
        try:
            values = tuple(float(row[k]) for k in ('relative_time_s', 'image_x', 'image_y'))
            return values if all(math.isfinite(v) for v in values) else None
        except (KeyError, TypeError, ValueError):
            return None

    manual = sorted((point(row) for row in (anchors if anchors is not None else observations)
                     if str(row.get('source', '')).upper() not in AUTO_SOURCES and point(row) is not None),
                    key=lambda p: p[0])
    step = frame_step_s if math.isfinite(frame_step_s) and frame_step_s > 0 else 1 / 30
    accepted, rejected = [], []
    for row in observations:
        p = point(row)
        conflict = None
        if p is not None and str(row.get('source', '')).upper() in AUTO_SOURCES:
            for start, end in zip(manual, manual[1:]):
                # Restrict this check to early free flight, not apex or landing.
                if not (0 <= start[0] < p[0] < end[0] <= .5 and end[0] - p[0] >= 1.5 * step - 1e-6):
                    continue
                dx, dy = end[1] - start[1], end[2] - start[2]
                length = math.hypot(dx, dy)
                if length < 20:
                    continue
                progress = ((p[1] - start[1]) * dx + (p[2] - start[2]) * dy) / length
                across = abs((p[1] - start[1]) * dy - (p[2] - start[2]) * dx) / length
                tolerance = max(2., .005 * length)
                if progress >= length - tolerance and across <= max(4., .02 * length):
                    conflict = {'reason': 'automatic_point_reaches_manual_anchor_too_early',
                                'observation': dict(row), 'manual_anchor_time_s': end[0],
                                'seconds_early': end[0] - p[0],
                                'distance_to_manual_anchor_px': math.hypot(p[1] - end[1], p[2] - end[2])}
                    break
        if conflict:
            rejected.append(conflict)
        else:
            accepted.append(row)
    return accepted, rejected


def is_usable_flight_observation(row):
    """Keep explicitly reviewed detections without inflating their confidence."""
    return (row.get("source") != "COMPUTER_VISION"
            or row.get("confidence") == "HIGH"
            or row.get("human_reviewed") is True)
