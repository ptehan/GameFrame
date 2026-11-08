"""Decode and inspect rebuilt instructional media without changing source videos."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json,subprocess,cv2,sys
root=Path.cwd();base=root/'demo-output/gameframe-instructions-refresh';review=base/'video-review';review.mkdir(exist_ok=True)
items=[('walkthrough','GameFrame-Guided-Walkthrough-Rebuilt'),('technical','GameFrame-Technical-Explainer-Rebuilt')]
if len(sys.argv)>1:items=[item for item in items if item[0] in sys.argv[1:]]
def verify(item):
 kind,name=item;p=root/'output/video'/(name+'.mp4')
 if not p.exists():return {'kind':kind,'status':'not finished'}
 story=json.loads((base/kind/'timed-storyboard.json').read_text())
 info=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_chapters','-show_format','-of','json',str(p)]))
 v=next(s for s in info['streams'] if s['codec_type']=='video');a=next(s for s in info['streams'] if s['codec_type']=='audio')
 assert (v['width'],v['height'])==(1280,720)
 assert int(v['nb_frames'])==story['total_frames']
 assert len(info['chapters'])==len(story['scenes'])
 assert abs(float(info['format']['duration'])-story['duration_s'])<.12
 subprocess.run(['ffmpeg','-v','error','-xerror','-i',str(p),'-f','null','-'],check=True,capture_output=True)
 cap=cv2.VideoCapture(str(p),cv2.CAP_FFMPEG,[cv2.CAP_PROP_N_THREADS,1])
 for index,s in enumerate(story['scenes']):
  t=s['start_s']+min(2,s['duration_s']/2)
  cap.set(cv2.CAP_PROP_POS_MSEC,t*1000);ok,f=cap.read();assert ok
  cv2.imwrite(str(review/f'{kind}-{index:02}-390.jpg'),cv2.resize(f,(390,219),interpolation=cv2.INTER_AREA))
 cap.release()
 return {'kind':kind,'video':str(p),'full_decode':'passed','frames':int(v['nb_frames']),'audio_codec':a['codec_name'],'chapters':len(info['chapters']),'duration_s':float(info['format']['duration'])}
with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(verify,items))
file=review/'walkthrough-technical-validation.json'
previous=json.loads(file.read_text()) if file.exists() else []
merged={r['kind']:r for r in previous}
merged.update({r['kind']:r for r in results})
file.write_text(json.dumps(list(merged.values()),indent=2));print(json.dumps(results,indent=2))
