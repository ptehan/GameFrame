"""Suggest reviewable field landmarks from a single video frame.

This is deliberately conservative. It returns plausible white field-marking
components and foul-line endpoint candidates, but the app still treats them as
LOW confidence suggestions for the user to review.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def read_frame(video: Path, time_s: float, max_width: int) -> tuple[np.ndarray, float]:
    capture = cv2.VideoCapture(str(video), cv2.CAP_FFMPEG, [cv2.CAP_PROP_N_THREADS, 1])
    if not capture.isOpened():
        raise ValueError(f"Could not open video: {video}")
    capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, time_s) * 1000.0)
    ok, frame = capture.read()
    capture.release()
    if not ok or frame is None:
        raise ValueError(f"Could not read frame at {time_s:.3f}s")
    scale = 1.0
    if frame.shape[1] > max_width:
        scale = max_width / frame.shape[1]
        frame = cv2.resize(frame, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    return frame, scale


def component_rows(mask: np.ndarray, min_area: int, max_area: int) -> list[dict]:
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    rows = []
    for label in range(1, count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area < min_area or area > max_area:
            continue
        x0 = int(stats[label, cv2.CC_STAT_LEFT])
        y0 = int(stats[label, cv2.CC_STAT_TOP])
        w = int(stats[label, cv2.CC_STAT_WIDTH])
        h = int(stats[label, cv2.CC_STAT_HEIGHT])
        cx, cy = centroids[label]
        rows.append({"x": float(cx), "y": float(cy), "area": area, "bbox": (x0, y0, x0 + w, y0 + h), "w": w, "h": h})
    return rows


def add_suggestion(suggestions: list[dict], landmark: str, x: float, y: float, scale: float, confidence: str, note: str) -> None:
    if not np.isfinite(x) or not np.isfinite(y):
        return
    for existing in suggestions:
        if existing["landmark"] == landmark and abs(existing["image_x"] - x / scale) < 24 and abs(existing["image_y"] - y / scale) < 24:
            return
    suggestions.append(
        {
            "landmark": landmark,
            "image_x": round(float(x) / scale, 2),
            "image_y": round(float(y) / scale, 2),
            "uncertainty_px": 45 if confidence == "LOW" else 30,
            "source": "COMPUTER_VISION",
            "confidence": confidence,
            "note": note,
        }
    )


def fit_white_baseline(hsv, a, b):
    """Refine a search line onto a neutral, bright chalk ridge.

    A red/green edge can seed the search, but cannot pass without white pixels
    brighter than both surrounding surfaces along a substantial line length.
    """
    h,w=hsv.shape[:2];a=np.asarray(a,float);b=np.asarray(b,float)
    length=np.linalg.norm(b-a)
    if length<1:return None
    center=(a+b)/2;base=(b-a)/length
    along=np.linspace(-length/2,length/2,max(32,min(400,int(length/2))))
    offsets=np.arange(-10.,10.01,1.)
    best=None
    for angle in np.radians([-1.5,-.75,0,.75,1.5]):
        direction=np.array([base[0]*np.cos(angle)-base[1]*np.sin(angle),base[0]*np.sin(angle)+base[1]*np.cos(angle)])
        normal=np.array([-direction[1],direction[0]])
        points=center+along[:,None,None]*direction+offsets[None,:,None]*normal
        positions=np.rint(points).astype(int)
        valid=(positions[:,:,0]>=0)&(positions[:,:,0]<w)&(positions[:,:,1]>=0)&(positions[:,:,1]<h)
        def values(shift):
            p=np.rint(points+normal*shift).astype(int)
            return hsv[np.clip(p[:,:,1],0,h-1),np.clip(p[:,:,0],0,w-1)]
        pixels=values(0);left=values(-4);right=values(4)
        contrast=pixels[:,:,2].astype(float)-(left[:,:,2].astype(float)+right[:,:,2].astype(float))/2
        supported=valid&(pixels[:,:,1]<=85)&(pixels[:,:,2]>=100)&(contrast>=8)
        coverage=supported.mean(axis=0)
        scores=coverage*2+np.where(supported,contrast,0).mean(axis=0)/255-np.abs(offsets)*.0001
        for column in np.flatnonzero(coverage>=.35):
            indices=np.flatnonzero(supported[:,column]);first,last=indices[0],indices[-1]
            if np.linalg.norm(points[last,column]-points[first,column])<w*.10:continue
            score=float(scores[column])
            if best is None or score>best[0]:
                best=(score,points[first,column],points[last,column],float(coverage[column]))
    return None if best is None else {'a':best[1],'b':best[2],'white_support':best[3]}


def detect_contact_landmarks(frame_bgr, scale, package):
    """Use the contact ray and mapped camera to search actual paint, not players.

    Geometry narrows the image search. If the rubber is hidden, a visible mound
    can supply a separately labelled, less certain top-center suggestion.
    """
    h, w = frame_bgr.shape[:2]
    contact = next((r for r in package.get('ball_observations', [])
                    if r.get('role') == 'CONTACT_POINT' or r.get('relative_time_s') == 0), None)
    camera = package.get('camera') or {}
    xy = camera.get('field_xy_ft') or (camera.get('actual_field_map') or {}).get('camera_xy_ft')
    if not contact or not xy:
        return []
    center = np.array([float(xy['x']), float(xy['y']), float(camera.get('height_ft') or 6)])
    if np.linalg.norm(center[:2]) < 3:
        return []
    uv = np.array([float(contact['image_x']), float(contact['image_y'])]) * scale
    target = np.array([0., 0., 3.])
    forward = target - center
    forward /= np.linalg.norm(forward)
    right = np.cross(forward, [0., 0., 1.]); right /= np.linalg.norm(right)
    down = np.cross(forward, right)
    focal = w * .9

    def project(points):
        vectors = np.array(points, dtype=float) - center
        depth = vectors @ forward
        return np.column_stack([vectors @ right, vectors @ down]) * focal / depth[:, None] + uv

    hsv = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
    white = ((hsv[:, :, 2] > 145) & (hsv[:, :, 1] < 90)).astype(np.uint8)
    white[:int(h * .2)] = 0
    # Long painted lines survive small breaks. Thin foreground net strands do
    # not have the same broad white support as chalk in the field region.
    clean = cv2.morphologyEx(white, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    lines = cv2.HoughLinesP(clean * 255, 1, np.pi/720, threshold=25,
                            minLineLength=max(25, w//18), maxLineGap=20)
    # Recover dim, thin chalk next to contrasting field surfaces. Requiring
    # ground on both sides avoids promoting bright net strands in the sky.
    red=((hsv[:,:,0]<30)|(hsv[:,:,0]>165))&(hsv[:,:,1]>45)
    green=(hsv[:,:,0]>32)&(hsv[:,:,0]<100)&(hsv[:,:,1]>35)
    kernel=np.ones((9,9),np.uint8)
    boundary=cv2.dilate(red.astype(np.uint8),kernel)&cv2.dilate(green.astype(np.uint8),kernel)
    faint=((hsv[:,:,2]>95)&(hsv[:,:,1]<115)&(boundary>0)).astype(np.uint8)
    faint[:int(h*.25)]=0
    extra=cv2.HoughLinesP(faint*255,1,np.pi/720,threshold=30,minLineLength=max(40,int(w*.10)),maxLineGap=35)
    raw_lines=[*(() if lines is None else lines.reshape(-1,4)),*(() if extra is None else extra.reshape(-1,4))]
    home = project([[0, 0, 0]])[0]
    suggestions = []
    selected = []
    side_candidates = []
    field = package.get('field') or {}
    base = float(field.get('base_distance_ft') or 90) / np.sqrt(2)
    for side, sign in [('first', 1), ('third', -1)]:
        candidates = []
        side_candidates.append(candidates)
        predicted = project([[0, 0, 0], [sign*base, base, 0]])
        direction = predicted[1] - predicted[0]
        if np.linalg.norm(direction) < 8:
            continue
        direction /= np.linalg.norm(direction)
        for raw in raw_lines:
            a, b = raw[:2].astype(float), raw[2:].astype(float)
            delta = b-a; length = np.linalg.norm(delta)
            if length<w*.10:continue
            if any(abs(np.dot(delta/length,(d-c)/np.linalg.norm(d-c)))>.995
                   and abs(((d-c)[0]*(a-c)[1]-(d-c)[1]*(a-c)[0])/np.linalg.norm(d-c))<8 for c,d in selected):continue
            alignment = abs(np.dot(delta/length, direction))
            offset = home-a
            distance = abs((delta[0]*offset[1]-delta[1]*offset[0])/length)
            along = np.dot((a+b)/2-home, direction)
            # A distant fence can have excellent white support and roughly the
            # right orientation. Baselines must also extrapolate back toward
            # the contact-anchored plate, not merely pass somewhere nearby.
            if alignment < .94 or distance > h*.25 or along < -w*.03:
                continue
            paint=fit_white_baseline(hsv,a,b)
            if paint is None:continue
            a,b=paint['a'],paint['b'];delta=b-a;length=np.linalg.norm(delta)
            alignment=abs(np.dot(delta/length,direction))
            distance=abs((delta[0]*(home-a)[1]-delta[1]*(home-a)[0])/length)
            score = length*alignment*(.6+.4*paint['white_support'])
            candidates.append((score,a,b))
    # Select a pair jointly. White fence rails and the mound edge may look like
    # individual lines, but they do not meet at the plate below contact.
    pairs=[]
    for first in side_candidates[0]:
        for third in side_candidates[1]:
            _,a,b=first;_,c,d=third
            u=b-a;v=d-c
            sine=abs(np.linalg.det(np.column_stack([u,v])))/(np.linalg.norm(u)*np.linalg.norm(v))
            if sine<.10:continue
            intersection=a+u*np.linalg.solve(np.column_stack([u,-v]),c-a)[0]
            if abs(intersection[0]-uv[0])>w*.12 or not uv[1]-h*.015<=intersection[1]<=uv[1]+h*.28:continue
            # Both segments must run outwards from their common plate, rather
            # than be two separated portions of one background feature.
            if (a+b-2*intersection)@(c+d-2*intersection)>0:continue
            penalty=1+abs(intersection[0]-uv[0])/(w*.04)
            pairs.append(((first[0]+third[0])/penalty,first,third,intersection))
    if pairs:
        _,first,third,home=max(pairs,key=lambda row:row[0])
        for side,best in [('first',first),('third',third)]:
            if best is not None:
                _, a, b = best
                if np.linalg.norm(b-home) < np.linalg.norm(a-home): a, b = b, a
                selected.append((a, b))
                for suffix, point in [('near', a), ('far', b)]:
                    add_suggestion(suggestions, f'{side}_baseline_{suffix}', *point, scale, 'LOW',
                                   'Detected white paint/chalk along the baseline; review before using.')
    if len(selected) == 2:
        a,b = selected[0]; c,d = selected[1]
        matrix = np.column_stack([b-a, -(d-c)])
        if abs(np.linalg.det(matrix)) > 1:
            intersection = a + (b-a)*np.linalg.solve(matrix, c-a)[0]
            if np.linalg.norm(intersection-home) < h*.15:
                home = intersection
                add_suggestion(suggestions, 'home_plate', *home, scale, 'LOW',
                               'Intersection of detected baselines; verify the point of home plate.')
        # Fit lens scale and orientation to the detected baseline directions and
        # their intersection. The contact-based projection is only an initial
        # search hint; keeping its arbitrary focal length displaces the rubber.
        if any(row['landmark'] == 'home_plate' for row in suggestions):
            from scipy.optimize import least_squares
            base_rotation = np.vstack([right, down, forward])
            def fitted_projection(points, params):
                rotation = cv2.Rodrigues(np.array([params[1],params[2],0.]))[0] @ base_rotation
                vectors = (np.array(points,dtype=float)-center) @ rotation.T
                return vectors[:,:2]*np.exp(params[0])/np.maximum(vectors[:,2,None],.1)+[w/2,h/2]
            def residual(params):
                projected = fitted_projection([[0,0,0],[base,base,0],[-base,base,0]],params)
                errors=list((projected[0]-home)/3)
                for point,(a,b) in zip(projected[1:],selected):
                    d=b-a;offset=point-a
                    errors.append((d[0]*offset[1]-d[1]*offset[0])/np.linalg.norm(d)/3)
                return errors
            fit = least_squares(residual,[np.log(focal),0,0],
                                bounds=([np.log(w*.25),-.8,-1.2],[np.log(w*4),.8,1.2]),max_nfev=100)
            rubber_world = [[0,float(field.get('mound_distance_ft') or 60.5),0]]
            plausible_shift = np.linalg.norm(fitted_projection(rubber_world,fit.x)[0]-project(rubber_world)[0]) < w*.04
            if np.linalg.norm(residual(fit.x)) < 8 and plausible_shift:
                def project(points): return fitted_projection(points,fit.x)
    components = component_rows(clean, 4, max(100, int(w*h*.0015)))
    expected_mound = project([[0,float(field.get('mound_distance_ft') or 60.5),0]])[0] + home-project([[0,0,0]])[0]
    mound_top = find_mound_top(hsv, expected_mound, home)
    for name, world in [('home_plate', [0,0,0]), ('pitching_rubber', [0,float(field.get('mound_distance_ft') or 60.5),0])]:
        if any(r['landmark'] == name for r in suggestions): continue
        predicted = project([world])[0] + home-project([[0,0,0]])[0]
        radius = h*(.055 if name == 'home_plate' else .07)
        candidates = [c for c in components if c['w'] >= c['h']*.8 and c['w'] < w*.07
                      and np.linalg.norm(np.array([c['x'],c['y']])-predicted) < radius]
        if name == 'pitching_rubber':
            def on_mound(component):
                x,y=int(component['x']),int(component['y']);radius=max(8,int(w*.015))
                patch=hsv[max(0,y-radius):min(h,y+radius),max(0,x-radius):min(w,x+radius)]
                if not patch.size: return False
                dirt=((patch[:,:,0]<30)|(patch[:,:,0]>165))&(patch[:,:,1]>45)&(patch[:,:,2]>40)
                return np.mean(dirt)>.18
            # Require the white mark to be on the isolated mound itself.
            # A white shoe/chalk spot near the plate is not rubber evidence,
            # even when an approximate camera projection points toward it.
            candidates=[c for c in candidates if mound_top is not None and on_mound(c)
                        and abs(c['x']-mound_top[0])<w*.035 and abs(c['y']-mound_top[1])<h*.02]
        if candidates:
            best = min(candidates, key=lambda c: np.linalg.norm(np.array([c['x'],c['y']])-predicted))
            add_suggestion(suggestions, name, best['x'], best['y'], scale, 'LOW',
                           'White field marking near the geometry prediction; verify before using.')
    if not any(row['landmark'] == 'pitching_rubber' for row in suggestions):
        mound_world = [[0,float(field.get('mound_distance_ft') or 60.5),0]]
        predicted = project(mound_world)[0] + home-project([[0,0,0]])[0]
        mound = mound_top
        if mound is not None:
            add_suggestion(suggestions, 'pitching_rubber', *mound, scale, 'LOW',
                           'Rubber not visible: approximate top center of the mound, located using field lines and camera geometry. Drag to correct before continuing.')
            suggestions[-1].update(uncertainty_px=round(max(60.,h*.10/scale),1),
                                   estimate_kind='MOUND_TOP_APPROXIMATION',rubber_visible=False)
    return suggestions


def find_mound_top(hsv, predicted, home):
    """Find an isolated dirt/turf mound near the geometrically expected rubber.

    Use full-image components so cropping the large infield cannot turn it into
    a fake mound. No mound-shaped image evidence means no fallback suggestion.
    """
    h,w=hsv.shape[:2]
    dirt=(((hsv[:,:,0]<30)|(hsv[:,:,0]>165))&(hsv[:,:,1]>45)&(hsv[:,:,2]>40)).astype(np.uint8)
    dirt=cv2.morphologyEx(dirt,cv2.MORPH_CLOSE,np.ones((3,7),np.uint8))
    candidates=[]
    # In a low camera view the mound may touch a thin base path. A vertical
    # opening breaks that connection while retaining the thicker mound body.
    heights=sorted({max(3,int(round(size*w/960))|1) for size in (5,7,9)})
    masks=[dirt]+[cv2.morphologyEx(dirt,cv2.MORPH_OPEN,np.ones((height,3),np.uint8)) for height in heights]
    for mask in masks:
        for comp in component_rows(mask,max(25,int(w*h*.0001)),int(w*h*.035)):
            if not (w*.015<comp['w']<w*.33 and 2<comp['h']<h*.10 and 1.8<comp['w']/comp['h']<18): continue
            if comp['area']/(comp['w']*comp['h'])<.42:continue
            if abs(comp['x']-predicted[0])>w*.16 or abs(comp['y']-predicted[1])>h*.12: continue
            if np.linalg.norm(np.array([comp['x'],comp['y']])-home)<h*.09: continue
            distance=np.linalg.norm((np.array([comp['x'],comp['y']])-predicted)/[w*.12,h*.08])
            thickness=comp['area']/comp['w']
            score=distance-.5*np.log1p(comp['area'])-.35*min(h*.04,thickness)
            candidates.append((score,comp,mask))
    if not candidates:return None
    _,comp,dirt=min(candidates,key=lambda pair:pair[0])
    x0,y0,x1,y1=comp['bbox']
    # Follow the mound's visible upper contour near its center, rather than
    # placing the marker a fixed fraction down inside the dirt footprint.
    count,labels,stats,_=cv2.connectedComponentsWithStats(dirt[y0:y1,x0:x1],8)
    if count<2:return None
    mound_label=1+int(np.argmax(stats[1:,cv2.CC_STAT_AREA]))
    middle=(x1-x0-1)/2
    half_band=max(2,int((x1-x0)*.12))
    tops=[]
    for x in range(max(0,int(middle)-half_band),min(x1-x0,int(middle)+half_band+1)):
        ys=np.flatnonzero(labels[:,x]==mound_label)
        if ys.size:tops.append(float(ys[0]))
    if not tops:return None
    return np.array([(x0+x1-1)/2,y0+float(np.median(tops))])


def detect_landmarks(frame_bgr: np.ndarray, scale: float, package=None) -> list[dict]:
    if package is not None:
        return detect_contact_landmarks(frame_bgr, scale, package)
    h, w = frame_bgr.shape[:2]
    hsv = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)

    # White chalk/bases/rubber: bright, low-saturation pixels. Morphology joins
    # broken paint/bases without turning the whole net into one component.
    white = ((hsv[:, :, 2] > 160) & (hsv[:, :, 1] < 85)).astype(np.uint8)
    white[: int(h * 0.18), :] = 0
    white = cv2.morphologyEx(white, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    white = cv2.morphologyEx(white, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (5, 3)))

    suggestions: list[dict] = []
    comps = component_rows(white, min_area=5, max_area=700)
    field_comps = []
    for comp in comps:
        x0, y0, x1, y1 = comp["bbox"]
        patch = gray[y0:y1, x0:x1]
        if patch.size == 0:
            continue
        mean_v = float(np.mean(patch[white[y0:y1, x0:x1] > 0])) if np.any(white[y0:y1, x0:x1]) else 0.0
        if mean_v < 150:
            continue
        # Reject very tall net/fence pieces.
        if comp["h"] > max(24, comp["w"] * 3.5):
            continue
        field_comps.append({**comp, "mean_v": mean_v})

    # Home plate is usually the lowest central white field marking.
    central = [c for c in field_comps if abs(c["x"] - w / 2) < w * 0.35 and c["y"] > h * 0.48]
    if central:
        home = max(central, key=lambda c: c["y"] + c["area"] * 0.12)
        used = {id(home)}
        add_suggestion(suggestions, "home_plate", home["x"], home["y"], scale, "LOW", "Auto-suggested lowest central white field marking.")

        # Rubber is a small horizontal-ish white mark above home, nearer the center.
        rubber_candidates = [
            c
            for c in field_comps
            if c is not home
            and c["y"] < home["y"] - h * 0.10
            and c["y"] > h * 0.22
            and abs(c["x"] - home["x"]) < w * 0.28
            and c["w"] >= c["h"]
        ]
        if rubber_candidates:
            rubber = min(rubber_candidates, key=lambda c: abs(c["x"] - home["x"]) + abs((home["y"] - c["y"]) - h * 0.28))
            used.add(id(rubber))
            add_suggestion(suggestions, "pitching_rubber", rubber["x"], rubber["y"], scale, "LOW", "Auto-suggested central white horizontal mark above home.")

        # Bases are white components around the infield, roughly left/right/far of home.
        available = [c for c in field_comps if id(c) not in used]
        left = [c for c in available if c["x"] < home["x"] - w * 0.10 and c["y"] < home["y"] - h * 0.06]
        right = [c for c in available if c["x"] > home["x"] + w * 0.10 and c["y"] < home["y"] - h * 0.06]
        far = [c for c in available if abs(c["x"] - home["x"]) < w * 0.32 and c["y"] < home["y"] - h * 0.16]
        if right:
            first = min(right, key=lambda c: abs(c["y"] - (home["y"] - h * 0.16)))
            used.add(id(first))
            add_suggestion(suggestions, "first_base", first["x"], first["y"], scale, "LOW", "Auto-suggested white infield component to the first-base side.")
        if left:
            third = min(left, key=lambda c: abs(c["y"] - (home["y"] - h * 0.16)))
            used.add(id(third))
            add_suggestion(suggestions, "third_base", third["x"], third["y"], scale, "LOW", "Auto-suggested white infield component to the third-base side.")
        far = [c for c in far if id(c) not in used]
        if far:
            second = min(far, key=lambda c: abs(c["y"] - (home["y"] - h * 0.30)))
            add_suggestion(suggestions, "second_base", second["x"], second["y"], scale, "LOW", "Auto-suggested far white infield component.")

    # Far foul-line endpoints: look for long bright/yellow-ish fence/pole/line
    # components near the outfield edge. These are endpoint hints, not full poles.
    yellow = ((hsv[:, :, 0] >= 15) & (hsv[:, :, 0] <= 45) & (hsv[:, :, 1] > 60) & (hsv[:, :, 2] > 115)).astype(np.uint8)
    bright_line = ((hsv[:, :, 2] > 150) & (hsv[:, :, 1] < 120)).astype(np.uint8)
    far_band = np.zeros_like(yellow)
    far_band[int(h * 0.18) : int(h * 0.70), :] = 1
    endpoint_mask = ((yellow | bright_line) & far_band).astype(np.uint8)
    endpoint_mask = cv2.morphologyEx(endpoint_mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (9, 3)))
    endpoints = component_rows(endpoint_mask, min_area=18, max_area=2500)
    endpoints = [c for c in endpoints if c["w"] > 18 or c["h"] > 18]
    if endpoints:
        left_end = min(endpoints, key=lambda c: c["x"])
        right_end = max(endpoints, key=lambda c: c["x"])
        if left_end["x"] < w * 0.42:
            add_suggestion(suggestions, "left_foul_line_far", left_end["x"], left_end["y"], scale, "LOW", "Auto-suggested far foul-line endpoint/fence intersection.")
        if right_end["x"] > w * 0.58:
            add_suggestion(suggestions, "right_foul_line_far", right_end["x"], right_end["y"], scale, "LOW", "Auto-suggested far foul-line endpoint/fence intersection.")

    return suggestions[:9]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--time", required=True, type=float)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--max-width", default=960, type=int)
    parser.add_argument('--package', type=Path)
    args = parser.parse_args()

    frame, scale = read_frame(args.video, args.time, args.max_width)
    package = json.loads(args.package.read_text(encoding='utf-8')) if args.package else None
    suggestions = detect_landmarks(frame, scale, package)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"scale": scale, "landmarks": suggestions}, indent=2), encoding="utf-8")
    print(f"Wrote {args.out} ({len(suggestions)} suggestions)")


if __name__ == "__main__":
    main()
