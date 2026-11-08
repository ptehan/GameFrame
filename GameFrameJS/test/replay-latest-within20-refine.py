from pathlib import Path
source=Path('test/replay-latest-within20.py').read_text();exec(source[:source.index('fit=minimize')])
def residual(v):
 f,uv=flight(v)
 return np.r_[(uv-pixels).ravel(),max(0,f.distance_ft-hi)/.001,max(0,lo-f.distance_ft)/.001,max(0,abs(landing(v)-bearing)-6)*100]
fit=least_squares(residual,[91.12,21.4,-11.57],bounds=([40,0,bearing-6],[120,60,bearing+6]),diff_step=1e-4,max_nfev=35)
f,uv=flight(fit.x)
report={'success':bool(fit.success),'ev_mph':float(fit.x[0]),'launch_deg':float(fit.x[1]),'initial_spray_deg':float(fit.x[2]),'landing_bearing_deg':landing(fit.x),'distance_ft':f.distance_ft,'rmse_px':math.sqrt(cost(fit.x))};print(json.dumps(report));(root/'demo-output/latest-within20-video-fit.json').write_text(json.dumps(report,indent=2))
