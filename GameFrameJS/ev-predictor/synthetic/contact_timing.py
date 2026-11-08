"""Separate measured frame positions from an event occurring between frames."""
import math
import numpy as np


def prepare_contact_observations(observations):
    """Extrapolate an image anchor only for an explicitly fractional contact.

    The real pixel remains at its measured timestamp. MODEL_ANCHOR is not an
    independent observation and must not count toward confidence. No landing
    distance, flight candidate, spray, or fitted speed influences this anchor.
    """
    observations=list(observations)
    if any(abs(float(r.get('relative_time_s',-1)))<1e-6 for r in observations):
        return observations
    first=next((r for r in observations if r.get('role')=='CONTACT_POINT'
                and r.get('contact_timing_mode')=='BETWEEN_FRAMES'),None)
    if first is None:
        return observations
    rows=sorted((r for r in observations if str(r.get('source','')).upper() in {'HUMAN','MANUAL','USER'}
        and all(isinstance(r.get(k),(int,float)) and math.isfinite(r[k]) for k in ('relative_time_s','image_x','image_y'))
        and 0<r['relative_time_s']<=.45),key=lambda r:r['relative_time_s'])
    if len(rows)<2 or not 0<rows[0]['relative_time_s']<=.05 or rows[-1]['relative_time_s']-rows[0]['relative_time_s']<.1:
        return observations
    times=np.array([r['relative_time_s'] for r in rows]); degree=min(3,len(rows)-1)
    pixels=np.array([[r['image_x'],r['image_y']] for r in rows])
    anchor=[float(np.polynomial.polynomial.polyfit(times,pixels[:,i],degree)[0]) for i in range(2)]
    allowance=max(float(r.get('uncertainty_px') or 12) for r in rows)
    result=[{**r,'role':'BALL'} if r is first else dict(r) for r in observations]
    result.insert(0,dict(relative_time_s=0.,image_x=anchor[0],image_y=anchor[1],
        source='MODEL_ANCHOR',role='CONTACT_POINT',uncertainty_px=allowance,
        contact_timing_mode='BETWEEN_FRAMES',independent_observation=False,
        note='Image anchor extrapolated to the selected contact instant; not a clicked ball position.'))
    return result
