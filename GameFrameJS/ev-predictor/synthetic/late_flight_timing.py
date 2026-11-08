"""Late marks constrain WHEN the image trajectory turns, never absolute height."""
import math


def late_timing_evidence(rows, frame_step_s=1/30):
    rows=sorted(rows,key=lambda r:r['relative_time_s'])
    rising=[];falling=[]
    def uncertainty(row):
        def positive(key,default):
            v=row.get(key,default)
            return float(v) if isinstance(v,(int,float)) and math.isfinite(v) and v>=0 else default
        return math.hypot(positive('uncertainty_px',6.),positive('camera_registration_uncertainty_px',0.))
    for i,a in enumerate(rows):
      for b in rows[i+1:]:
        dt=b['relative_time_s']-a['relative_time_s']
        # Do not infer a turn across a long disappearance/camera repositioning.
        if not 0<dt<=.5:continue
        dy=b['image_y']-a['image_y']
        noise=1.5*math.hypot(uncertainty(a),uncertainty(b))
        if abs(dy)<=noise:continue
        pair=[float(a['relative_time_s']),float(b['relative_time_s'])]
        if dy<0:rising.append(pair)
        else:falling.append(pair)
    # Falling then rising again is camera/tracking ambiguity, not evidence
    # that a physical flight should turn upwards a second time.
    inconsistent=any(f[1]<=r[0] for f in falling for r in rising)
    lower=max((p[0] for p in rising),default=None)
    upper=min((p[1] for p in falling),default=None)
    used=bool(rising or falling) and not inconsistent
    return dict(used=used,policy='timing_only',uses_absolute_height=False,
        uses_late_horizontal=False,uses_physical_apex_as_image_apex=False,
        rising_intervals_s=rising,falling_intervals_s=falling,
        image_apex_not_before_s=lower if used else None,
        image_apex_not_after_s=upper if used else None,
        tolerance_s=max(.05,2*frame_step_s),
        reason='Late marks constrain rise/descent timing; absolute later positions are not scored.' if used else
        'Later apparent reversals may be camera movement; no turn-time constraint is applied.' if inconsistent else
        'Later marks do not establish a reliable rise/descent interval.')


def timing_error_seconds(evidence, projected_apex_time):
    if not evidence.get('used') or projected_apex_time is None:return 0.
    lower=evidence.get('image_apex_not_before_s');upper=evidence.get('image_apex_not_after_s')
    return max(0.,lower-projected_apex_time if lower is not None else 0.,
               projected_apex_time-upper if upper is not None else 0.)


def timing_score(evidence, projected_apex_time):
    return (timing_error_seconds(evidence,projected_apex_time)/evidence['tolerance_s'])**2 if evidence.get('used') else 0.
