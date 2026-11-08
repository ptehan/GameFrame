"""Register ball marks using background evidence, never a proposed ball flight."""
from pathlib import Path
import math
import os
import numpy as np
from prediction_cancel import check_cancelled

EARLY_END_S = 2 / 3


def detector_reuse_neighbors(rows,contact):
    """Six checked early anchors; other points remain geometric holdouts."""
    reference=contact.get('video_time_s')
    eligible=[i for i,r in enumerate(rows) if r.get('human_reviewed') is True
        and r.get('source')=='COMPUTER_VISION' and r.get('background_alignment_reliable') is True
        and all(isinstance(r.get(k),(int,float)) and math.isfinite(r[k]) for k in ('relative_time_s','reference_time_s','reference_image_x','reference_image_y'))
        and 0<r['relative_time_s']<=EARLY_END_S and reference is not None and abs(r['reference_time_s']-reference)<1e-5]
    eligible.sort(key=lambda i:rows[i]['relative_time_s'])
    if len(eligible)<=6:return {}
    anchors=[eligible[i] for i in np.unique(np.round(np.linspace(0,len(eligible)-1,6)).astype(int))]
    neighbors={}
    for i in eligible:
        if i in anchors:continue
        before=[j for j in anchors if rows[j]['relative_time_s']<rows[i]['relative_time_s']]
        after=[j for j in anchors if rows[j]['relative_time_s']>rows[i]['relative_time_s']]
        if before and after and rows[after[0]]['relative_time_s']-rows[before[-1]]['relative_time_s']<=.12:
            neighbors[i]=(before[-1],after[0])
    return neighbors


def reuse_detector_registration(rows,checks,index,neighbors):
    if index not in neighbors:return None
    anchors=neighbors[index]
    for j in anchors:
        check=checks[j];row=rows[j]
        if not check.get('reliable') or np.linalg.norm(np.asarray(check['point'])-[row['reference_image_x'],row['reference_image_y']])>2:return None
    row=rows[index]
    return {'time_s':row.get('relative_time_s'),'reliable':True,
        'point':[row['reference_image_x'],row['reference_image_y']],
        'uncertainty_px':max(1.,*(checks[j].get('uncertainty_px',0)+.5 for j in anchors)),
        'method':'detector_alignment_checked_between_anchors','anchor_indices':list(anchors)}


def background_registration(src,dst,row,size,scale):
    """Identical acceptance checks for tracked and descriptor-matched pixels."""
    import cv2
    if src is None or len(src)<40:return None
    matrix,inliers=cv2.findHomography(src,dst,cv2.RANSAC,2*scale)
    if matrix is None or inliers is None:return None
    accepted=inliers.ravel().astype(bool);a,b=src[accepted],dst[accepted]
    if len(a)<30 or np.ptp(a[:,0])<size[0]*.25 or np.ptp(a[:,1])<size[1]*.1:return None
    residual=np.linalg.norm(cv2.perspectiveTransform(a[:,None],matrix)[:,0]-b,axis=1)/scale
    if np.percentile(residual,95)>3:return None
    point=np.float32([[[row['image_x']*scale,row['image_y']*scale]]])
    mapped=cv2.perspectiveTransform(point,matrix)[0,0]/scale
    samples=[]
    for parity in (0,1):
        partial,_=cv2.findHomography(a[parity::2],b[parity::2],0)
        if partial is not None:samples.append(cv2.perspectiveTransform(point,partial)[0,0]/scale)
    if len(samples)!=2:return None
    uncertainty=max(float(np.linalg.norm(p-mapped)) for p in samples)
    if not np.isfinite(mapped).all() or not math.isfinite(uncertainty) or uncertainty>6:return None
    return {'time_s':row.get('relative_time_s'),'reliable':True,'point':mapped.tolist(),
            'uncertainty_px':uncertainty,'inliers':len(a),
            'background_rms_px':float(np.sqrt(np.mean(residual**2)))}


def distributed_background_points(points, size, limit=320):
    """Keep strong features across the field before trying the full feature set."""
    if points is None or len(points) <= limit:
        return points
    buckets = [[] for _ in range(32)]
    for index, (x, y) in enumerate(points[:, 0]):
        column = min(7, max(0, int(x * 8 / size[0])))
        row = min(3, max(0, int(y * 4 / size[1])))
        buckets[row * 8 + column].append(index)
    chosen = []
    for rank in range(max(map(len, buckets))):
        for bucket in buckets:
            if rank < len(bucket):
                chosen.append(bucket[rank])
                if len(chosen) == limit:
                    return points[chosen]
    return points[chosen]


def tracked_background(reference,current,points,initial_shift=None):
    """Track contact-frame background directly, with a round-trip check."""
    import cv2
    if points is None or len(points)<40:return None,None
    options=dict(winSize=(21,21),maxLevel=3,
                 criteria=(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,30,.01))
    initial=None if initial_shift is None else points+np.asarray(initial_shift,np.float32)
    moved,status,_=cv2.calcOpticalFlowPyrLK(reference,current,points,initial,
        flags=cv2.OPTFLOW_USE_INITIAL_FLOW if initial is not None else 0,**options)
    if moved is None:return None,None
    back,reverse,_=cv2.calcOpticalFlowPyrLK(current,reference,moved,None,**options)
    if back is None:return None,None
    good=(status.ravel()>0)&(reverse.ravel()>0)&(np.linalg.norm(back-points,axis=2).ravel()<.75)
    good&=np.isfinite(moved).all(axis=(1,2))
    return moved[good,0],points[good,0]


def apply_registration(rows, registrations, early_end=EARLY_END_S):
    corrected, excluded = [], []
    for row, registration in zip(rows, registrations):
        late = row.get('relative_time_s', 0) > early_end
        if registration.get('reliable'):
            corrected.append({**row, 'image_x': registration['point'][0],
                              'image_y': registration['point'][1],
                              'camera_registered': True,
                              'camera_registration_uncertainty_px': registration.get('uncertainty_px', 0)})
        elif late:
            excluded.append({'time_s': row['relative_time_s'], 'reason': registration.get('reason', 'Background alignment uncertain')})
        else:
            corrected.append(dict(row))
    return corrected, excluded


def register_ball_observations(package, rows):
    """Unknown late camera movement cannot veto the early measurements.

    An independent homography maps each frame to contact. Inlier coverage,
    residuals and split-sample agreement at the ball reject unsafe sky
    extrapolation. Missing late evidence is excluded, never fitted away.
    """
    meta = package.get('video_metadata') or {}
    contact = next((r for r in rows if abs(r.get('relative_time_s', -1)) < 1e-6), None)
    checks = [{'reliable': False, 'reason': 'Source video unavailable for camera correction'} for _ in rows]
    source = meta.get('source_path')
    diagnostic = {'used': False, 'method': 'independent_static_background_registration',
                  'late_horizontal_used': False, 'frames': checks}
    if contact is not None and source and Path(source).is_file():
        import cv2
        previous_threads=cv2.getNumThreads()
        # Small ORB/matching jobs lose time scheduling a large native pool.
        # Keep all features and matching rules; restore the process setting.
        target_threads=min(2,max(1,previous_threads))
        if target_threads != previous_threads:
            cv2.setNumThreads(target_threads)
        cap = cv2.VideoCapture(str(source))
        try:
            source_fps = cap.get(cv2.CAP_PROP_FPS)
            sequential = (meta.get('variable_frame_rate') is False
                          and meta.get('timing_source') == 'source_frame_timestamps'
                          and math.isfinite(source_fps) and source_fps > 0)
            def read(t):
                check_cancelled()
                target = round(float(t) * source_fps) if sequential else -1
                cursor = round(cap.get(cv2.CAP_PROP_POS_FRAMES))
                # Nearby CFR marks can share the decoder's current position.
                # Unknown/VFR timing and large or backward jumps retain seeks.
                if sequential and 0 <= target-cursor <= 15:
                    for _ in range(target-cursor):
                        if not cap.grab(): return None
                else:
                    cap.set(cv2.CAP_PROP_POS_MSEC, float(t) * 1000)
                ok, image = cap.read()
                if not ok: return None
                return image
            base = read(contact.get('video_time_s', 0))
            if base is not None:
                h, w = base.shape[:2]
                if (int(meta.get('width_px') or w), int(meta.get('height_px') or h)) == (w, h):
                    scale = min(1., 960 / w)
                    size = (round(w * scale), round(h * scale))
                    def gray(image): return cv2.cvtColor(cv2.resize(image, size), cv2.COLOR_BGR2GRAY)
                    mask = np.zeros((size[1], size[0]), np.uint8)
                    mask[round(size[1] * .30):round(size[1] * .75)] = 255
                    reference_gray=gray(base)
                    corners=cv2.goodFeaturesToTrack(reference_gray,maxCorners=1000,qualityLevel=.01,minDistance=8,mask=mask)
                    sparse_corners = distributed_background_points(corners, size)
                    orb = cv2.ORB_create(nfeatures=3500)
                    ref_keys,ref_desc=None,None
                    reuse_neighbors=detector_reuse_neighbors(rows,contact)
                    order=[i for i in range(len(rows)) if i not in reuse_neighbors]+list(reuse_neighbors)
                    for i in order:
                        row=rows[i]
                        if row is contact:
                            checks[i] = {'reliable': True, 'point': [row['image_x'], row['image_y']], 'uncertainty_px': 0.}
                            continue
                        reused=reuse_detector_registration(rows,checks,i,reuse_neighbors)
                        if reused is not None:
                            checks[i]=reused
                            continue
                        check = {'reliable': False, 'time_s': row.get('relative_time_s'), 'reason': 'Background alignment uncertain'}
                        checks[i] = check
                        image = read(row.get('video_time_s', 0))
                        if image is None or image.shape != base.shape: continue
                        current_gray=gray(image)
                        hint=None
                        if all(isinstance(row.get(k),(int,float)) and math.isfinite(row[k]) for k in ('reference_image_x','reference_image_y')):
                            hint=np.array([row['image_x']-row['reference_image_x'],row['image_y']-row['reference_image_y']])*scale
                        use_flow = os.environ.get('GAMEFRAME_BACKGROUND_FLOW','1') != '0'
                        src,dst=tracked_background(reference_gray,current_gray,sparse_corners,hint) if use_flow else (None,None)
                        registration=background_registration(src,dst,row,size,scale)
                        if registration is None and use_flow and sparse_corners is not corners:
                            # Keep the original dense tracking and descriptor
                            # fallback when the faster attempt is inconclusive.
                            src,dst=tracked_background(reference_gray,current_gray,corners,hint)
                            registration=background_registration(src,dst,row,size,scale)
                        if registration is not None:
                            registration['method']='round_trip_background_flow'
                            checks[i]=registration
                            continue
                        # Difficult tracking retains the existing independent
                        # descriptor method and all of its acceptance gates.
                        if ref_keys is None:
                            ref_keys,ref_desc=orb.detectAndCompute(reference_gray,mask)
                        if ref_desc is None:continue
                        keys, desc = orb.detectAndCompute(current_gray, mask)
                        if desc is None: continue
                        pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(desc, ref_desc, k=2)
                        good = [a for pair in pairs if len(pair) == 2 for a, b in [pair] if a.distance < .7 * b.distance]
                        if len(good) < 40: continue
                        src = np.float32([keys[m.queryIdx].pt for m in good])
                        dst = np.float32([ref_keys[m.trainIdx].pt for m in good])
                        registration=background_registration(src,dst,row,size,scale)
                        if registration is not None:
                            registration['method']='background_descriptors'
                            checks[i]=registration
        except (cv2.error, OSError, ValueError):
            # Failed registration is missing evidence, not a failed EV job.
            pass
        finally:
            cap.release()
            if target_threads != previous_threads:
                cv2.setNumThreads(previous_threads)
    corrected, excluded = apply_registration(rows, checks)
    diagnostic.update(used=any(r.get('camera_registered') and r.get('relative_time_s', 0) > 0 for r in corrected),
                      excluded_late_points=excluded,
                      uncertainty_note='Later positions with uncertain camera alignment are excluded; early marks and supplied distance remain the available constraints.' if excluded else None)
    return corrected, diagnostic
