"""Decode the complete exports and inspect a frame from every tutorial scene."""
import array,json,math,subprocess,wave,os
from pathlib import Path
from PIL import Image,ImageDraw

root=Path(__file__).resolve().parents[1]
folder=Path(os.environ['WALKTHROUGH_DIR']).resolve() if os.environ.get('WALKTHROUGH_DIR') else root/'demo-output/cortland-double-85'
story=json.loads((folder/'timed-storyboard.json').read_text())
report=json.loads((folder/'render-report.json').read_text())
ffmpeg=root/'node_modules/ffmpeg-static/ffmpeg.exe'
qa=folder/'video-qa';qa.mkdir(exist_ok=True)
def run(args):
 p=subprocess.run([str(ffmpeg),'-hide_banner','-loglevel','error','-y',*map(str,args)],capture_output=True)
 if p.returncode:raise RuntimeError(p.stderr.decode(errors='replace'))
indices=[round((s['start_s']+s['duration_s']/2)*30) for s in story['scenes']]
select='+'.join(f'eq(n\\,{n})' for n in indices)
run(['-i',report['video'],'-vf',f'select={select},scale=640:-2','-fps_mode','vfr',qa/'scene-%02d.jpg'])
run(['-i',report['video'],'-vn','-f','null','-'])
run(['-i',story['voiceover_mp3'],'-f','null','-'])
files=sorted(qa.glob('scene-*.jpg'));assert len(files)==len(story['scenes'])
for start in range(0,len(files),12):
 sheet=Image.new('RGB',(1920,1600),'#dde5e1');draw=ImageDraw.Draw(sheet)
 for i,file in enumerate(files[start:start+12]):
  im=Image.open(file);im.thumbnail((636,358));x=i%3*640;y=i//3*400
  sheet.paste(im,(x,y));draw.text((x+8,y+365),f"{start+i+1}. {story['scenes'][start+i]['title']}",fill='black')
 sheet.save(qa/f'contact-{start//12+1}.jpg')
levels=[]
for scene in story['scenes']:
 with wave.open(scene['voice_wav'],'rb') as w:
  assert w.getnframes()==scene['frames']*1600
  data=array.array('h',w.readframes(w.getnframes()))
  peak=max(abs(x) for x in data)/32768
  rms=math.sqrt(sum(x*x for x in data)/len(data))/32768
  assert .005<rms<.5 and peak<1
  assert scene['voice_delay_s']+scene['voice_duration_s']<=scene['duration_s']
  levels.append({'title':scene['title'],'rms':rms,'peak':peak})
assert len(report['chapters'])==story.get('expected_chapter_count',5)
assert [s['title'] for s in story['scenes'] if s.get('source_video')]==story.get('expected_source_titles',['Existing EV output','Existing pitch-speed output','Existing matchup output'])
result={'decoded_video':True,'decoded_mp3':True,'scene_frames':len(files),'audio_levels':levels,'duration_s':story['duration_s'],'chapters':report['chapters']}
(qa/'verification.json').write_text(json.dumps(result,indent=2))
print(json.dumps({k:v for k,v in result.items() if k!='audio_levels'}))
