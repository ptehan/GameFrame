"""Sample input sensitivity separately from nominal flight acceptance."""
import math
import numpy as np
from direction_first_match import registered_origin
from camera_geometry import motion_basis
from prediction_cancel import check_cancelled


def launch_angle_sensitivity(rows, pose, bearing_deg, frame_step_s=1/30):
    from staged_flight_match import derive_early_hypotheses, EARLY_END_S
    valid = [r for r in rows if all(isinstance(r.get(k),(int,float)) and math.isfinite(r[k]) for k in ('relative_time_s','image_x','image_y'))
             and (str(r.get('source','')).upper() in {'HUMAN','MANUAL','USER','MODEL_ANCHOR'} or r.get('human_reviewed') is True)]
    contact = next((r for r in valid if abs(r['relative_time_s'])<1e-6), None)
    early = sorted([r for r in valid if 0<r['relative_time_s']<=EARLY_END_S+frame_step_s*.5 and r.get('role') not in {'FIRST_GROUND_CONTACT','GROUND_CONTACT','TERMINAL','CATCH'}],key=lambda r:r['relative_time_s'])
    diagnostic = dict(method='sampled_geometry_and_mark_sensitivity',is_confidence_interval=False,
                      uses_late_points=False,uses_landing_distance=False,
                      varied_inputs=['camera_position','camera_height','camera_orientation','field_of_view','contact_depth','contact_click','hit_direction','ball_clicks'])
    if not (pose.get('calibration_diagnostics') or {}).get('usable_for_velocity',True):
        return {**diagnostic,'range_deg':None,'poorly_constrained':True,'reason':'Field calibration does not support an independent launch-angle range.'}
    if contact is None or len(early)<2:
        return {**diagnostic,'range_deg':None,'poorly_constrained':True,'reason':'Too few early positions to independently constrain launch angle.'}
    pixels = np.array([[r['image_x'],r['image_y']] for r in early],dtype=float)
    def allowance(row):
        value=row.get('uncertainty_px',6.)
        marked=float(value) if isinstance(value,(int,float)) and math.isfinite(value) and value>0 else 6.
        registration=row.get('camera_registration_uncertainty_px',0.)
        registration=float(registration) if isinstance(registration,(int,float)) and math.isfinite(registration) and registration>0 else 0.
        return math.hypot(marked,registration)
    sigma=np.array([allowance(r) for r in early])
    contact_pixel=np.array([contact['image_x'],contact['image_y']])
    poses=[pose]+[{**pose,**p} for p in pose.get('_uncertainty_poses',[])]
    angles=[];conditions=[];attempts=0
    def collect(camera, point, observed, depths=True):
        nonlocal attempts
        check_cancelled()
        origin=registered_origin(point,camera,bearing_deg)
        if origin is None:return
        center=-np.asarray(camera['rotation']).T@np.asarray(camera['translation'])
        ray=origin-center;ray/=np.linalg.norm(ray)
        prior=np.asarray(camera.get('contact_position_prior_sigma_ft',[5.,5.,1.]))
        depth_sigma=1/math.sqrt(float(np.sum((ray/prior)**2)))
        variants=((0.,0.),(-depth_sigma,0.),(depth_sigma,0.)) if depths else ((0.,0.),)
        hypotheses=derive_early_hypotheses(observed,camera,origin,bearing_deg,direction_step_deg=1.5,variants=variants)
        attempts+=9*len(variants)
        for h in hypotheses:
            z=h['origin_ft'][2]
            if not .25<=z<=10:continue
            angles.append(h['launch_angle_deg'])
        along=np.array([math.sin(math.radians(bearing_deg)),math.cos(math.radians(bearing_deg))])
        condition=float(np.linalg.cond(motion_basis(origin,along,camera)))
        conditions.append(min(condition,1e12) if math.isfinite(condition) else 1e12)
    # Correlated camera, contact-depth and common mark errors are combined.
    for camera in poses:
        for dx,dy in [(0,0),(-1,-1),(-1,1),(1,-1),(1,1)]:
            collect(camera,contact_pixel,pixels+sigma[:,None]*np.array([dx,dy])/math.sqrt(2))
    # Independent clicks: disturb every early point, rather than only a mean line.
    for i in range(len(early)):
        for axis in (0,1):
            for sign in (-1,1):
                moved=pixels.copy();moved[i,axis]+=sign*sigma[i]
                collect(pose,contact_pixel,moved,False)
    for axis in (0,1):
        for sign in (-1,1):
            point=contact_pixel.copy();point[axis]+=sign*allowance(contact)
            collect(pose,point,pixels,False)
    if not angles:
        return {**diagnostic,'range_deg':None,'poorly_constrained':True,'reason':'The early view does not resolve a stable launch angle.'}
    low,high=float(min(angles)),float(max(angles))
    unstable=high-low>10 or max(conditions,default=0)>100 or low<.5 or high>59.5 or (pose.get('calibration_diagnostics') or {}).get('uncertainty_sampling_limited',False)
    return {**diagnostic,'range_deg':[low,high],'width_deg':high-low,'poorly_constrained':unstable,
            'camera_pose_count':len(poses),'valid_samples':len(angles),'attempted_samples':attempts,
            'worst_projection_condition':float(max(conditions)),
            'reason':'This view is sensitive to camera geometry, hit direction or marking accuracy; launch angle has a wide uncertainty range.' if unstable else 'Launch-angle range includes sampled camera, direction and marking uncertainty.',
            'limitations':'A sampled sensitivity envelope, not a calibrated confidence interval or proof that every angle fits the later flight.'}
