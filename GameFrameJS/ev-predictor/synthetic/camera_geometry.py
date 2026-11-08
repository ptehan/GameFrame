"""Camera calibration and exact local perspective derivatives."""
import math
import numpy as np
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation
from match_vantage_grid import intrinsics_from_fov, project_with_camera_pose
from prediction_cancel import check_cancelled


def projection_jacobian(point, pose):
    rotation = np.asarray(pose['rotation'])
    k = np.asarray(pose['intrinsics'])
    q = k @ (rotation @ np.asarray(point).reshape(3) + np.asarray(pose['translation']))
    if not np.isfinite(q).all() or q[2] <= 1e-9:
        raise ValueError('Contact is not in front of the camera.')
    return ((k[:2] * q[2] - q[:2, None] * k[2]) / q[2]**2) @ rotation


def motion_basis(point, ground_direction, pose):
    jac = projection_jacobian(point, pose)
    direction = np.array(ground_direction, dtype=float, copy=True)
    direction /= max(float(np.linalg.norm(direction)), 1e-12)
    return np.column_stack((jac @ np.r_[direction, 0.], jac[:, 2]))


def line_errors(projected, marked):
    delta = projected[1] - projected[0]
    normal = np.array([-delta[1], delta[0]]) / max(float(np.linalg.norm(delta)), 1e-9)
    return (marked - projected[0]) @ normal


def refine_field_camera(pose, package, world, image, baselines, width, height):
    """Fit field evidence with soft map/height priors; no ball flight is used."""
    mapped = np.asarray(pose['camera_center_ft']).copy()
    settings = package.get('camera') or {}
    def positive(key, default):
        value = settings.get(key)
        return float(value) if isinstance(value, (int, float)) and math.isfinite(value) and value > 0 else default
    sigma_xy = positive('position_uncertainty_ft', 5.)
    sigma_z = positive('height_uncertainty_ft', 1.)
    sigma = np.array([sigma_xy, sigma_xy, sigma_z])
    sufficient = len(baselines) == 2 or (len(world) >= 3 and np.linalg.matrix_rank(world[:, :2] - world[0, :2]) == 2)
    def unpack(params):
        center = params[4:7]
        rotation = Rotation.from_rotvec(params[:3]).as_matrix()
        intrinsics = intrinsics_from_fov(width, height, params[3])
        return intrinsics, rotation, -rotation @ center, center
    def field_residual(params):
        k, r, t, _ = unpack(params)
        projected, visible = project_with_camera_pose(world, k, r, t)
        errors = [((projected-image)/3.).ravel(), np.where(visible, 0., 500.)]
        for ground, marked in baselines:
            line, _ = project_with_camera_pose(ground, k, r, t)
            errors.append(line_errors(line, marked)/3.)
        return np.concatenate(errors)
    def residual(params):
        check_cancelled()
        z = (params[4:7]-mapped)/sigma
        # A large map mistake must not overpower well-aligned field landmarks.
        prior = z*np.sqrt(2/(np.sqrt(1+z*z)+1))
        return np.r_[field_residual(params), prior]
    start = np.r_[Rotation.from_matrix(pose['rotation']).as_rotvec(), pose['horizontal_fov_deg'], mapped]
    lower = np.array([-np.inf]*3+[10.,-1000.,-1000.,.5])
    upper = np.array([np.inf]*3+[120.,1000.,1000.,40.])
    fit = least_squares(residual, np.clip(start, lower+1e-6, upper-1e-6), bounds=(lower,upper), max_nfev=700) if sufficient else None
    refined = fit is not None and fit.success and np.isfinite(fit.fun).all()
    params = fit.x if refined else start
    k, r, t, center = unpack(params)
    projected, visible = project_with_camera_pose(world, k, r, t)
    point_rmse = float(np.sqrt(np.mean((projected-image)**2)))
    lines = np.concatenate([line_errors(project_with_camera_pose(g,k,r,t)[0],p) for g,p in baselines]) if baselines else np.array([])
    line_rmse = float(np.sqrt(np.mean(lines**2))) if len(lines) else None
    at_limit = bool(params[3] <= 10.01 or params[3] >= 119.99 or center[2] <= .51 or center[2] >= 39.99 or np.any(np.abs(center[:2]) >= 999.))
    usable = bool(np.all(visible) and not at_limit and point_rmse <= 10 and (line_rmse is None or line_rmse <= 5) and (not sufficient or refined))
    variants = []
    if refined:
        # Sample correlated pose uncertainty, including focal length and height.
        _, s, vt = np.linalg.svd(fit.jac, full_matrices=False)
        covariance = (vt.T * (1 / np.maximum(s, 1e-10)**2)) @ vt
        values, vectors = np.linalg.eigh(covariance)
        best_field_cost = float(np.sum(field_residual(params)**2))
        for value, vector in zip(values, vectors.T):
            for sign in (-1,1):
                trial = params + sign*2*np.sqrt(max(0.,value))*vector
                if np.any(trial <= lower) or np.any(trial >= upper): continue
                if float(np.sum(field_residual(trial)**2)) > best_field_cost+9: continue
                kk, rr, tt, cc = unpack(trial)
                _, vv = project_with_camera_pose(world,kk,rr,tt)
                if not vv.all(): continue
                variants.append(dict(intrinsics=kk,rotation=rr,translation=tt,camera_center_ft=cc))
    else:
        # Underconstrained fields retain explicit map/height uncertainty.
        for axis in range(3):
            for sign in (-1,1):
                cc = center.copy();cc[axis] += sign*sigma[axis]
                if cc[2] <= .5: continue
                # Refit orientation/focal length to the same field evidence;
                # simply translating a camera would contradict the landmarks.
                def partial_residual(values):
                    check_cancelled()
                    return np.r_[field_residual(np.r_[values,cc]), (values[3]-params[3])/18.]
                partial=least_squares(partial_residual,params[:4],bounds=(lower[:4],upper[:4]),max_nfev=150)
                trial=np.r_[partial.x,cc]
                if np.sum(field_residual(trial)**2)>np.sum(field_residual(params)**2)+9:continue
                kk,rr,tt,_=unpack(trial)
                variants.append(dict(intrinsics=kk,rotation=rr,translation=tt,camera_center_ft=cc))
    displacement = float(np.linalg.norm(center[:2]-mapped[:2]))
    discrepancy = displacement > max(10.,2*sigma_xy) or abs(float(center[2]-mapped[2])) > 2*sigma_z
    diagnostic = dict(method='field_refined_soft_map_prior' if refined else 'underconstrained_map_prior',
        mapped_camera_center_ft=mapped.tolist(),fitted_camera_center_ft=center.tolist(),
        camera_adjustment_ft=float(np.linalg.norm(center-mapped)),map_position_prior_sigma_ft=sigma_xy,
        camera_height_ft=float(center[2]),camera_height_uncertainty_ft=sigma_z,
        landmark_rmse_px=point_rmse,baseline_rmse_px=line_rmse,baseline_errors_px=lines.tolist(),
        at_parameter_limit=at_limit,usable_for_velocity=usable,uses_ball_or_landing_distance=False,
        map_discrepancy=discrepancy,uncertainty_pose_count=len(variants),uncertainty_sampling_limited=len(variants)<4,
        message='Field marks and mapped camera position disagree. The fitted field geometry is used; review the camera mark or field marks.' if discrepancy else None)
    return {**pose,'intrinsics':k,'rotation':r,'translation':t,'camera_center_ft':center,
            'target_ft':center+r[2]*100.,'horizontal_fov_deg':float(params[3]),'rmse_px':point_rmse,
            'calibration_diagnostics':diagnostic,'_uncertainty_poses':variants}
