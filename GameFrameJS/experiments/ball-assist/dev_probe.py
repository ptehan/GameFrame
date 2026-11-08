"""Fast development check on raw frames; score labels only after inference."""
import json,os,sys,tempfile,time
from pathlib import Path
from contact_scan import scan
root=Path(__file__).resolve().parents[2];out=root/'demo-output/ball-assist-lab'
session_id=sys.argv[1];limit=int(sys.argv[2]) if len(sys.argv)>2 else 100
folder=out/session_id;meta=json.loads((folder/'session.json').read_text())
reference=json.loads((out/os.environ.get('PROBE_REFERENCE','selected-reference.json')).read_text())[0]
alignment=json.loads((out/os.environ['PROBE_ALIGNMENT']).read_text())['rows'] if os.environ.get('PROBE_ALIGNMENT') else []
prefix=os.environ.get('PROBE_PREFIX','dev')
contact=next(p for p in reference['manual_points'] if p['relative_s']==0)
nearest=lambda t:min(range(len(meta['times'])),key=lambda i:abs(meta['times'][i]-t))
def frame_for(point):
 decoded=next((r['displayed_time_s'] for r in alignment if r['hit_id']==reference['hit_id'] and abs(r['requested_time_s']-point['time_s'])<1e-7),point['time_s'])
 return nearest(decoded)
sx=meta['width']/reference['width'];sy=meta['height']/reference['height']
seed={'frame':frame_for(contact),'x':contact['x']*sx,'y':contact['y']*sy}
started=time.time()
all_files=sorted((folder/'frames').glob('frame-*.jpg'))
with tempfile.TemporaryDirectory(dir=out,prefix='probe-') as temp:
 for file in all_files[:limit]:os.link(file,Path(temp)/file.name)
 result=scan({'frames_dir':temp,'fps':meta['fps'],'contact':seed,'debug':os.environ.get('PROBE_DEBUG','1')!='0'})
points={p['frame']:p for p in result['points']};checks=[]
for p in reference['manual_points']:
 f=frame_for(p)
 if p['relative_s']<=0 or f>=limit:continue
 q=points.get(f);checks.append({'frame':f,'proposed':bool(q),'error_px':((q['x']/sx-p['x'])**2+(q['y']/sy-p['y'])**2)**.5 if q else None})
report={'development_prefix_only':limit<len(all_files),'session':session_id,'elapsed_s':time.time()-started,'scanned':result['scanned_frames'],'expected_full_suffix':len(all_files)-seed['frame']-1,'points':result['points'],'checks':checks,'gaps':result['gaps'],'ground_review':result.get('ground_review')}
(out/(prefix+'-initial-debug.json')).write_text(json.dumps(result.get('debug',[])))
(out/(prefix+'-probe.json')).write_text(json.dumps(report,indent=2));print(json.dumps({**report,'points':len(points)}))
