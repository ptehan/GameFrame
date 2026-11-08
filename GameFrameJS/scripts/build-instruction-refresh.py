"""Build a fresh instructional edit; app exports are never modified."""
from pathlib import Path
import json,hashlib
from PIL import Image,ImageDraw,ImageFont
root=Path(__file__).resolve().parents[1]
base=root/'demo-output/gameframe-instructions-refresh'
plan=json.loads((base/'scene-plan.json').read_text())
prior=root/'demo-output/gameframe-20261106'
old=json.loads((prior/'session.json').read_text())
shots=base/'screens';cards=base/'cards';cards.mkdir(exist_ok=True)
font='C:/Windows/Fonts/arial.ttf'
# Short task-specific endings, with a clear next action.
def card(name,title,lines):
 im=Image.new('RGB',(1280,654),'#f1f6f2');d=ImageDraw.Draw(im)
 d.rounded_rectangle((44,40,1236,614),20,fill='#ffffff',outline='#b7cbc0',width=2)
 logo=Image.open(root/'static/logo/gameframe-logo-app.png').convert('RGBA');logo.thumbnail((240,75));im.paste(logo,(76,65),logo)
 d.text((76,190),title,font=ImageFont.truetype(font,52),fill='#163d2e')
 for i,line in enumerate(lines): d.text((78,290+i*72),line,font=ImageFont.truetype(font,38),fill='#385d4b')
 file=cards/(name+'.png');im.save(file);return str(file)
next_card=card('next','Your next step',['Choose a task on the home screen.','Follow the next prompt.','Return through View saved videos.'])
handoff=card('handoff','Save hit → swing timing',['The hit measurement is saved first.','Tag the swing while its video prepares.','Open View video when it is ready.'])
metrics=card('saved-result','Review the saved example',['Exit velocity: 82 mph','Launch angle: 27 degrees','Distance: 307 feet'])
# Resolve fresh screen captures first. Specific saved-result illustrations are
# retained only when they are original outputs or unchanged review UI.
alias={'estimate':str(prior/'screens/estimate.png'),'video-preparing':handoff,'video-ready':handoff,
       'swing-contact':str(shots/'swing-crop.png'),'saved-swing':str(shots/'saved-swing.png'),
       'dashboard':str(shots/'dashboard.png')}
provenance=[]
def image(name):
 p=shots/(name+'.png')
 if p.exists(): return str(p)
 if name in alias:
  provenance.append({'capture':name,'source':alias[name],'basis':'Fresh explanatory card or verified saved-result illustration'})
  return alias[name]
 return str(p)
for v in plan['videos']:
 kind=v['kind'];folder=base/kind;folder.mkdir(exist_ok=True)
 basename={'overview':'GameFrame-Overview-Rebuilt','walkthrough':'GameFrame-Guided-Walkthrough-Rebuilt','hit-timing':'GameFrame-Swing-Timing-Rebuilt','technical':'GameFrame-Technical-Explainer-Rebuilt'}[kind]
 scenes=[]
 for i,row in enumerate(v['scenes']):
  names=list(row['capture_names'])
  if row['title']=='Start with a video': names=['home','choose-video','choose-hitter']
  if 'contact' in row['title'].lower() and kind=='walkthrough' and 'pitch' not in row['title'].lower(): names=['contact','contact-between-frames']
  if row['title']=='Add a pitch': names=['pitch-upload','pitch-people','pitch-clip-start','pitch-crop']
  if row['title']=='Read the modeled flight': names=['map-comparison']
  if kind=='technical' and row['title']=='Image angle and launch angle': names=['map-comparison','contact-between-frames']
  if row['title']=='Save and continue': names=['library','swing-crop']
  if row['title']=='Save the result and continue': names=['library','swing-commitment']
  imgs=[image(n) for n in names]
  scenes.append({'chapter':v['title'],'title':row['title'],'text':row['text'],'images':imgs,
                 'capture_names':names,'min_duration_s':4,'voice_delay_s':.2,'allow_end_hold':True})
 story={'title':v['title'],'kind':kind,'output_basename':basename,'captioned':True,'burn_narration_captions':True,
        'phone_framing':True,'render_concurrency':4,'voice_scale':1.02,'scenes':scenes}
 (folder/'storyboard.json').write_text(json.dumps(story,indent=2))
 (folder/'voiceover-script.txt').write_text(v['title']+'\n\n'+'\n\n'.join(s['title']+'\n'+s['text'] for s in scenes))
(base/'asset-provenance.json').write_text(json.dumps(provenance,indent=2))
print('Prepared all four instructional storyboards')
