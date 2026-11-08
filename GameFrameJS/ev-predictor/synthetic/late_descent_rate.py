"""Speed evidence from relative, camera-corrected late vertical motion."""
import math
import numpy as np
from late_flight_timing import late_timing_evidence


def descent_rate_evidence(rows,frame_step_s=1/30,require_registration=True):
    result=dict(used=False,policy='relative_vertical_descent_rate',uses_absolute_height=False,
                uses_horizontal=False,is_confidence_interval=False,acceptance_multiplier=2.)
    valid=[r for r in rows if (not require_registration or r.get('camera_registered') is True)
        and all(isinstance(r.get(k),(int,float)) and math.isfinite(r[k])
                for k in ('relative_time_s','image_y'))]
    valid.sort(key=lambda r:r['relative_time_s'])
    timing=late_timing_evidence(valid,frame_step_s)
    if not timing['used'] or not timing['falling_intervals_s']:
        return {**result,'reason':'No reliable camera-corrected descent sequence.'}
    start=min(pair[0] for pair in timing['falling_intervals_s'])
    groups=[]
    for row in valid:
        if row['relative_time_s']<start:continue
        if not groups or row['relative_time_s']-groups[-1][-1]['relative_time_s']>.5+1e-6:
            groups.append([])
        if not groups[-1] or row['relative_time_s']>groups[-1][-1]['relative_time_s']:
            groups[-1].append(row)
    choices=[]
    def positive(row,key,default):
        value=row.get(key,default)
        return float(value) if isinstance(value,(int,float)) and math.isfinite(value) and value>=0 else default
    for group in groups:
        if len(group)<3 or group[-1]['relative_time_s']-group[0]['relative_time_s']<.25:continue
        times=np.array([r['relative_time_s'] for r in group]);ys=np.array([r['image_y'] for r in group])
        sigma=np.array([max(1.,math.hypot(positive(r,'uncertainty_px',6.),
            positive(r,'camera_registration_uncertainty_px',0.))) for r in group])
        def fit(weights):
            dt=times-np.average(times,weights=weights)
            dy=ys-np.average(ys,weights=weights)
            denominator=float(np.sum(weights*dt*dt))
            return dt,dy,float(np.sum(weights*dt*dy)/denominator),denominator
        _,_,initial,_=fit(1/sigma**2)
        time_sigma=np.array([positive(r,'timing_uncertainty_s',frame_step_s/2) for r in group])
        weights=1/(sigma**2+(initial*time_sigma)**2)
        dt,dy,slope,denominator=fit(weights)
        allowance=math.sqrt(1/denominator)
        if slope<=allowance:continue
        if len(group)>=4:
            # Smooth physical acceleration is not camera/tracking noise.
            # This quadratic is only a consistency check, not the speed fit.
            design=np.column_stack([np.ones(len(dt)),dt,dt**2])
            coefficients=np.linalg.lstsq(design*np.sqrt(weights[:,None]),ys*np.sqrt(weights),rcond=None)[0]
            residual=(ys-design@coefficients)*np.sqrt(weights)
        else:
            residual=(dy-slope*dt)*np.sqrt(weights)
        if np.max(np.abs(residual))>3:continue
        choices.append((allowance,dict(used=True,times_s=times.tolist(),
            observed_rate_px_per_s=slope,rate_allowance_px_per_s=allowance,
            weights=weights.tolist(),centered_times_s=dt.tolist(),
            slope_denominator=denominator,point_count=len(group),
            span_s=float(times[-1]-times[0]),
            reason='Compare the rate of descent, allowing an arbitrary common vertical offset.')))
    if not choices:return {**result,'reason':'At least three consistent descent marks spanning 0.25 seconds are needed.'}
    return {**result,**min(choices,key=lambda item:item[0])[1]}


def compare_descent_rate(evidence,times,projected_y,visible=None):
    if not evidence.get('used'):return dict(used=False,score=0.,consistent=True)
    times=np.asarray(times);indices=np.searchsorted(times,evidence['times_s'])
    invalid=(np.any(indices>=len(times)) or
             not np.allclose(times[np.minimum(indices,len(times)-1)],evidence['times_s'],atol=1e-6,rtol=0))
    if not invalid:
        invalid=(visible is not None and not np.asarray(visible)[indices].all()) or not np.isfinite(np.asarray(projected_y)[indices]).all()
    if invalid:return dict(used=True,score=1e9,consistent=False,valid_projection=False)
    values=np.asarray(projected_y)[indices]
    # Centering explicitly removes absolute late height; X never enters.
    values=values-np.average(values,weights=evidence['weights'])
    slope=float(np.sum(np.asarray(evidence['weights'])*evidence['centered_times_s']*values)/evidence['slope_denominator'])
    error=slope-evidence['observed_rate_px_per_s']
    normalized=error/evidence['rate_allowance_px_per_s']
    return dict(used=True,score=float(normalized**2),consistent=abs(normalized)<=evidence['acceptance_multiplier'],
                valid_projection=True,predicted_rate_px_per_s=slope,error_px_per_s=error,
                normalized_error=float(normalized))
