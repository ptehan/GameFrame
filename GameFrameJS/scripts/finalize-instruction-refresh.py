"""Wire fresh phone-framed captures and larger captions into narrated tutorials."""
from pathlib import Path
import json,hashlib,sys
from PIL import ImageFont,Image,ImageDraw
root=Path(__file__).resolve().parents[1]
base=root/'demo-output/gameframe-instructions-refresh'
manifest=json.loads((base/'phone-frames/manifest.json').read_text())['frames']
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',42)
kind_names=sys.argv[1:] or ['overview','walkthrough','hit-timing','technical']
alias={'swing-contact':'swing-crop','video-preparing':None}
card=base/'cards/handoff.png'
report=[]
prepared=base/'prepared-frames';prepared.mkdir(exist_ok=True)
def frame(name):
 name=alias.get(name,name)
 if name is None:source=card
 else:
  if name not in manifest:raise ValueError('Missing fresh frame: '+name)
  source=Path(manifest[name]['file'])
 dest=prepared/source.name
 digest=hashlib.sha256(source.read_bytes()).hexdigest()
 stamp=dest.with_suffix('.json')
 if not dest.exists() or not stamp.exists() or json.loads(stamp.read_text()).get('source_sha256')!=digest:
  image=Image.open(source).convert('RGB');image.thumbnail((1280,600),Image.Resampling.LANCZOS)
  canvas=Image.new('RGB',(1280,720),'#f2f5f2');canvas.paste(image,((1280-image.width)//2,0))
  ImageDraw.Draw(canvas).rectangle((0,600,1280,720),fill='#0b4d3a')
  canvas.save(dest);stamp.write_text(json.dumps({'source':str(source),'source_sha256':digest,'size':[1280,720]}))
 return str(dest)
def wrap(text):
 words=text.replace('\\N',' ').split();lines=[];line=''
 for word in words:
  candidate=(line+' '+word).strip()
  if line and font.getlength(candidate)>1160:lines.append(line);line=word
  else:line=candidate
 if line:lines.append(line)
 if len(lines)>2:raise ValueError('Caption needs more than two lines: '+text)
 return '\\N'.join(lines)
for kind in kind_names:
 folder=base/kind
 for filename in ['storyboard.json','timed-storyboard.json']:
  path=folder/filename
  if not path.exists():continue
  story=json.loads(path.read_text())
  for scene in story['scenes']:
   names=scene['capture_names']
   if kind=='overview' and scene['title']=='Build a matchup':names=['matchup-review','matchup-timing-frames','home-saved-videos']
   if kind=='hit-timing' and scene['title']=='Compare against a pitch':names=['matchup-pitch','matchup-swing','matchup-timing-frames']
   if kind=='technical' and scene['title']=='Save the result and continue':names=['save-hit-control','swing-commitment','home-saved-videos']
   if kind=='hit-timing' and scene['title']=='Review repeated swings':names=['dashboard']
   if kind=='overview' and scene['title']=='Save and continue':names=['save-hit-control','swing-crop','video-ready']
   if scene['title']=='Start a hit measurement':names=['home','choose-video']
   if scene['title']=='Review the field marks':names=['field-marks','field-manual','field-baseline']
   if scene['title']=='Review and save pitch speed':names=['pitch-review','pitch-saved','pitch-playback']
   if scene['title']=='Review the aligned result':names=['matchup-timing-frames','home-saved-videos']
   if scene['title']=='Save and move into timing':names=['save-hit-control','swing-crop','video-ready']
   if scene['title']=='Read the modeled flight':names=['map-comparison','estimate']
   if scene['title']=='What the estimate uses':names=['map-comparison','field-baseline','estimate']
   if scene['title']=='Check the landing mark':names=['map-landing','map-landing-certainty']
   scene['chapter']=scene['title']
   scene['capture_names']=names
   scene['images']=[frame(n) for n in names]
   if scene['title']=='Read the modeled flight' and (base/'source-videos/flight-plane.json').exists():
    clip=json.loads((base/'source-videos/flight-plane.json').read_text())
    scene.update(source_video=clip['path'],source_sha256=clip['sha256'],source_duration_s=clip['duration_s'],source_has_audio=False,source_duration_policy='narration')
   if 'caption_ass' in scene:
    ass=Path(scene['caption_ass']);lines=ass.read_text().splitlines()
    for i,line in enumerate(lines):
     if line.startswith('Style: Caption,'):
      parts=line.split(',');parts[2]='42';parts[-2]='12';lines[i]=','.join(parts)
     elif line.startswith('Dialogue: '):
      parts=line.split(',',9);parts[9]=wrap(parts[9]);lines[i]=','.join(parts)
    ass.write_text('\n'.join(lines)+'\n')
    scene['caption_sha256']=hashlib.sha256(ass.read_bytes()).hexdigest()
  story['phone_framing']=True
  story['precomposed_frames']=True
  story['render_concurrency']=4
  path.write_text(json.dumps(story,indent=2))
  if filename=='timed-storyboard.json':report.append({'kind':kind,'duration_s':story['duration_s'],'scenes':len(story['scenes'])})
print(json.dumps(report,indent=2))
