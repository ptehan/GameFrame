from pathlib import Path
source=Path('test/replay-latest-direction.py').read_text();exec(source[:source.index('results=[]')])
from scipy.optimize import minimize
lo,hi=299.,339.;bearing=old['field_direction']['spray_angle_deg']
def flight(v):return evaluate(v[:2],v[2])
def cost(v):return float(np.mean(np.sum((flight(v)[1]-pixels)**2,axis=1)))
def distance(v):return flight(v)[0].distance_ft
def landing(v):
 f=flight(v)[0];return math.degrees(math.atan2(f.landing_x_ft,f.landing_y_ft))
fit=minimize(cost,[90,22,-12],method='SLSQP',bounds=[(40,120),(0,60),(bearing-6,bearing+6)],constraints=[{'type':'ineq','fun':lambda v:distance(v)-lo},{'type':'ineq','fun':lambda v:hi-distance(v)},{'type':'ineq','fun':lambda v:6-abs(landing(v)-bearing)}],options={'maxiter':100,'ftol':1e-7,'eps':1e-3})
f,uv=flight(fit.x);report={'success':bool(fit.success),'message':fit.message,'ev_mph':float(fit.x[0]),'launch_deg':float(fit.x[1]),'initial_spray_deg':float(fit.x[2]),'landing_bearing_deg':landing(fit.x),'distance_ft':f.distance_ft,'rmse_px':math.sqrt(cost(fit.x))};print(json.dumps(report));(root/'demo-output/latest-within20-video-fit.json').write_text(json.dumps(report,indent=2))
