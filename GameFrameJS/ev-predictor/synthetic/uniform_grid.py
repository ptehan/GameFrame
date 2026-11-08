"""Uniform flight generation using a batched version of baseball_flight's equations.

The scalar simulator remains the reference; validate_batch checks parity before builds.
"""
import math
import numpy as np
from baseball_flight import Ball, Environment, StartPosition, Hit, simulate_trajectory
from load_sqlite import TRUTH_COLUMNS, TRAJECTORY_COLUMNS

DEFAULT_SPEEDS = range(40, 121, 2)
DEFAULT_LAUNCHES = range(0, 51, 2)
DEFAULT_SPRAYS = range(-33, 34, 3)


def cases(speeds=DEFAULT_SPEEDS, launches=DEFAULT_LAUNCHES, sprays=DEFAULT_SPRAYS):
    for speed in speeds:
        for launch in launches:
            for spray in sprays:
                yield speed, launch, spray


def simulate_batch(parameters):
    params=np.asarray(parameters,dtype=float)
    ev,la,phi=params.T
    n=len(params); env=Environment();ball=Ball();start=StartPosition();dt=.01
    back=-763+120*la+21*phi
    side=-849-94*phi
    side=np.where(side==0,.1,side)
    spin=np.hypot(back,side)
    temp=(5/9)*(env.temp_f-32);elev=env.elevation_ft/3.2808
    svp=4.5841*math.exp((18.687-temp/234.5)*temp/(257.14+temp))
    rho=1.2929*(273/(temp+273)*(29.92*1000/39.37*math.exp(-.0001217*elev)-.3783*env.relative_humidity_pct*svp/100)/760)*.06261
    k=.07182*rho*(5.125/ball.mass_oz)*(ball.circumference_in/9.125)**2
    lar=np.radians(la);pr=np.radians(phi);v0=ev*1.467
    vx=v0*np.cos(lar)*np.sin(pr);vy=v0*np.cos(lar)*np.cos(pr);vz=v0*np.sin(lar)
    wx=(back*np.cos(pr)-side*np.sin(lar)*np.sin(pr))*math.pi/30
    wy=(-back*np.sin(pr)-side*np.sin(lar)*np.cos(pr))*math.pi/30
    wz=side*np.cos(lar)*math.pi/30
    omega=np.where(spin==0,1e-9,spin*math.pi/30)
    romega=(ball.circumference_in/2/math.pi)*omega/12
    x=np.full(n,start.x_ft);y=np.full(n,start.y_ft);z=np.full(n,start.z_ft)
    speed=v0.copy();vw=np.sqrt(vx**2+vy**2+vz**2);sp=romega/vw
    active=np.ones(n,dtype=bool);apex=z.copy();apex_t=np.zeros(n)
    land_x=np.zeros(n);land_y=np.zeros(n);hang=np.zeros(n)
    samples=[]
    def record(mask,t,values):
        indices=np.flatnonzero(mask)
        if len(indices):
            xx,yy,zz,vxx,vyy,vzz,ss=values
            samples.append(np.column_stack((indices,np.full(len(indices),t),xx[indices],yy[indices],zz[indices],
                vxx[indices],vyy[indices],vzz[indices],ss[indices],np.hypot(xx[indices],yy[indices]),zz[indices])))
    record(active,0,(x,y,z,vx,vy,vz,speed))
    t=0.
    for step in range(1,1002):
        old=(x.copy(),y.copy(),z.copy(),vx.copy(),vy.copy(),vz.copy(),speed.copy())
        cd=.3008+.0292*(spin/1000)*np.exp(-t/(10000*146.7/vw))
        cl=1.120*sp/(.583+2.333*sp)
        ax=-k*cd*vw*vx+k*(cl/omega)*vw*(wy*vz-wz*vy)
        ay=-k*cd*vw*vy+k*(cl/omega)*vw*(wz*vx-wx*vz)
        az=-k*cd*vw*vz+k*(cl/omega)*vw*(wx*vy-wy*vx)-32.174
        x[active]+=(vx*dt+.5*ax*dt*dt)[active]
        y[active]+=(vy*dt+.5*ay*dt*dt)[active]
        z[active]+=(vz*dt+.5*az*dt*dt)[active]
        vx[active]+=(ax*dt)[active];vy[active]+=(ay*dt)[active];vz[active]+=(az*dt)[active]
        previous_t=t;t+=dt
        speed=np.sqrt(vx**2+vy**2+vz**2);vw=speed
        sp=(romega/vw)*np.exp(-t/(10000*146.7/vw))
        landed=active & (z<0)
        land_x[landed]=x[landed];land_y[landed]=y[landed];hang[landed]=t
        if (step-1)%3:
            record(landed,previous_t,old)
        active &= ~landed
        higher=active & (z>apex);apex[higher]=z[higher];apex_t[higher]=t
        if step%3==0:
            record(active,t,(x,y,z,vx,vy,vz,speed))
        if not active.any():
            break
    if active.any():
        raise ValueError(f'Flight did not land within reference time limit: {params[active].tolist()}')
    ids=[f'g_{int(e)}_{int(a)}_{int(s)}' for e,a,s in params]
    truth=[]
    for i,(e,a,s) in enumerate(params):
        row=dict(hit_id=ids[i],exit_velocity_mph=float(e),launch_angle_deg=float(a),spray_angle_deg=float(s),
            batter_hand='R',estimate_spin=1,note='Complete uniform grid; default environment and estimated spin',
            backspin_rpm=float(back[i]),sidespin_rpm=float(side[i]),spin_rpm=float(spin[i]),
            distance_ft=float(math.hypot(land_x[i],land_y[i])),hang_time_s=float(hang[i]),
            apex_ft=float(apex[i]),apex_time_s=float(apex_t[i]),landing_x_ft=float(land_x[i]),landing_y_ft=float(land_y[i]),
            landing_spray_angle_deg=math.degrees(math.atan2(land_x[i],land_y[i])),
            bfs_display_angle_deg=round(math.atan2(land_x[i]/2.4+.2,land_y[i]/2.4-78.4)*90/math.pi,1))
        truth.append(tuple(row[k] for k in TRUTH_COLUMNS))
    points=np.concatenate(samples)
    points=points[np.lexsort((points[:,1],points[:,0]))]
    records=[(ids[int(row[0])],*map(float,row[1:])) for row in points]
    return truth,records


def validate_batch():
    parameters=list(cases((40,80,120),(-10,0,23,40,60),(-33,-12,0,33)))
    truth,points=simulate_batch(parameters)
    by_hit={}
    for row in points:by_hit.setdefault(row[0],[]).append(row)
    worst=0.
    for params,values in zip(parameters,truth):
        row=dict(zip(TRUTH_COLUMNS,values));ref=simulate_trajectory(Hit(*params))
        for field in ('distance_ft','hang_time_s','apex_ft','apex_time_s','landing_x_ft','landing_y_ft','backspin_rpm','sidespin_rpm','spin_rpm'):
            error=abs(row[field]-getattr(ref,field));worst=max(worst,error)
            if error>1e-7:raise AssertionError((params,field,row[field],getattr(ref,field)))
        expected=[p for i,p in enumerate(ref.points) if i%3==0 or i==len(ref.points)-1]
        actual=by_hit[row['hit_id']]
        if len(actual)!=len(expected):raise AssertionError((params,len(actual),len(expected)))
        for got,want in zip(actual,expected):
            target=[want.t_s,want.x_ft,want.y_ft,want.z_ft,want.vx_ft_s,want.vy_ft_s,want.vz_ft_s,want.speed_ft_s,want.distance_ft,want.height_ft]
            error=float(np.max(np.abs(np.array(got[1:])-target)));worst=max(worst,error)
            if error>1e-7:raise AssertionError((params,'trajectory',error))
    return {'reference_cases':len(parameters),'maximum_absolute_difference':worst}
