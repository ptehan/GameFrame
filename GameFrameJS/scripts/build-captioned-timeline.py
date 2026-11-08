"""Reuse the verified narration while updating visuals and adding burned captions."""
import hashlib,json,math,re,subprocess,textwrap,wave
from pathlib import Path
root=Path(__file__).resolve().parents[1]
folder=root/'demo-output/cortland-double-85-wide'
old=json.loads((root/'demo-output/cortland-double-85/timed-storyboard.json').read_text(encoding='utf-8'))
new=json.loads((folder/'storyboard.json').read_text(encoding='utf-8'))
session=json.loads((folder/'session.json').read_text(encoding='utf-8'))
assert len(old['scenes'])==len(new['scenes'])
narration=folder/'narration';narration.mkdir(exist_ok=True)
captions=folder/'captions';captions.mkdir(exist_ok=True)
header='''[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 2
[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Caption,Arial,22,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,40,40,7,1
[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
'''
def ass_stamp(s):
 c=round(s*100);h,c=divmod(c,360000);m,c=divmod(c,6000);sec,c=divmod(c,100);return f'{h}:{m:02}:{sec:02}.{c:02}'
def srt_stamp(s):
 ms=round(s*1000);h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);sec,ms=divmod(ms,1000);return f'{h:02}:{m:02}:{sec:02},{ms:03}'
def chunks(text):
 result=[];current=[]
 for word in text.split():
  if current and (len(current)>=11 or len(' '.join(current+[word]))>74):result.append(' '.join(current));current=[]
  current.append(word)
  if len(current)>=5 and re.search(r'[.!?]$',word):result.append(' '.join(current));current=[]
 if current:result.append(' '.join(current))
 return result
def weight(text):return sum(max(1,len(re.findall(r'[aeiouy]+',word.lower())))+(.7 if re.search(r'[,.!?]$',word) else 0) for word in text.split())
def pcm_piece(reader,scene,frames):
 reader.setpos(round(scene['start_s']*48000));data=reader.readframes(scene['frames']*1600)
 return (data+b'\0'*(frames*3200))[:frames*3200]
def writer(file):
 w=wave.open(str(file),'wb');w.setnchannels(1);w.setsampwidth(2);w.setframerate(48000);return w
voice_file=narration/'full-voiceover.wav';mix_file=narration/'full-video-soundtrack.wav'
cursor=0;srt=[];count=0
with wave.open(old['voiceover_wav'],'rb') as voice, wave.open(old['video_soundtrack_wav'],'rb') as mix,writer(voice_file) as out_voice,writer(mix_file) as out_mix:
 for index,(previous,scene) in enumerate(zip(old['scenes'],new['scenes'])):
  assert previous['text']==scene['text'] and previous['title']==scene['title']
  frames=math.ceil((scene['source_duration_s']-.00001)*30) if scene.get('source_video') else previous['frames']
  assert previous['voice_delay_s']+previous['voice_duration_s']<frames/30
  voice_pcm=pcm_piece(voice,previous,frames);mix_pcm=pcm_piece(mix,previous,frames)
  out_voice.writeframes(voice_pcm);out_mix.writeframes(mix_pcm)
  part=narration/f'scene-{index:02}.wav'
  with writer(part) as w:w.writeframes(voice_pcm)
  scene.update(index=index,frames=frames,start_s=cursor/30,end_s=(cursor+frames)/30,duration_s=frames/30,voice_delay_s=previous['voice_delay_s'],voice_duration_s=previous['voice_duration_s'],voice_wav=str(part))
  if scene['title']=='Review pitch speed':scene['image_crop']=[1200,410,120,0]
  pieces=chunks(scene['text']);weights=[weight(p) for p in pieces];elapsed=0;events=[]
  for piece,value in zip(pieces,weights):
   start=scene['voice_delay_s']+elapsed/sum(weights)*scene['voice_duration_s'];elapsed+=value
   end=scene['voice_delay_s']+elapsed/sum(weights)*scene['voice_duration_s'];count+=1
   wrapped='\\N'.join(textwrap.wrap(piece,width=55)).replace('{','').replace('}','')
   events.append(f'Dialogue: 0,{ass_stamp(start)},{ass_stamp(end)},Caption,,0,0,0,,{wrapped}')
   srt.append(f"{count}\n{srt_stamp(scene['start_s']+start)} --> {srt_stamp(scene['start_s']+end)}\n"+'\n'.join(textwrap.wrap(piece,width=55))+'\n')
  ass=captions/f'scene-{index:02}.ass';ass.write_text(header+'\n'.join(events)+'\n',encoding='utf-8')
  scene.update(caption_ass=str(ass),caption_sha256=hashlib.sha256(ass.read_bytes()).hexdigest())
  cursor+=frames
mp3=root/'output/audio/Cortland-Double-Captioned-Voiceover.mp3'
result=subprocess.run([str(root/'node_modules/ffmpeg-static/ffmpeg.exe'),'-v','error','-y','-i',str(voice_file),'-c:a','libmp3lame','-b:a','192k',str(mp3)],capture_output=True)
if result.returncode:raise RuntimeError(result.stderr.decode(errors='replace'))
new.update(captioned=True,output_basename='Cortland-Double-Captioned-Walkthrough',duration_s=cursor/30,total_frames=cursor,voiceover_wav=str(voice_file),video_soundtrack_wav=str(mix_file),voiceover_mp3=str(mp3),pitch_id=session['pitch_id'],swing_id=session['swing_id'],matchup_id=session['matchup_id'])
(folder/'timed-storyboard.json').write_text(json.dumps(new,indent=2),encoding='utf-8')
(folder/'voiceover.srt').write_text('\n'.join(srt),encoding='utf-8')
print(json.dumps({'duration_s':cursor/30,'caption_cues':count,'pitch_id':session['pitch_id'],'swing_id':session['swing_id']}))
