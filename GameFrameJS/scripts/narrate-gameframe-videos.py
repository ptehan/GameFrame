"""Build branded overview/walkthrough narration and readable burned-caption cues."""
import hashlib,json,math,os,re,subprocess,textwrap,wave
from pathlib import Path
import numpy as np
import onnxruntime as ort
from piper import PiperVoice,SynthesisConfig

root=Path(__file__).resolve().parents[1]
base=Path(os.environ.get('GAMEFRAME_VIDEO_BASE',str(root/'demo-output/gameframe-polished')));cache=base/'voice-cache';cache.mkdir(exist_ok=True)
options_type=ort.SessionOptions
def options():
 result=options_type();result.intra_op_num_threads=2;result.inter_op_num_threads=1;return result
ort.SessionOptions=options
voice=None
ffmpeg=root/'node_modules/ffmpeg-static/ffmpeg.exe'
previous=json.loads((root/'demo-output/cortland-double-85-wide/timed-storyboard.json').read_text(encoding='utf-8'))
previous_by_text={s['text']:s for s in previous['scenes']}
header='''[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 2
[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Caption,Arial,24,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,40,40,7,1
[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
'''
def run(args):
 result=subprocess.run([str(ffmpeg),'-v','error','-y',*map(str,args)],capture_output=True)
 if result.returncode:raise RuntimeError(result.stderr.decode(errors='replace'))
def read(file):
 with wave.open(str(file),'rb') as w:
  assert w.getframerate()==48000 and w.getnchannels()==1 and w.getsampwidth()==2
  return np.frombuffer(w.readframes(w.getnframes()),dtype='<i2').copy()
def write(file,data):
 with wave.open(str(file),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(48000);w.writeframes(np.asarray(data,dtype='<i2').tobytes())
def stamp(s,ass=False):
 unit=100 if ass else 1000;t=round(s*unit);h,t=divmod(t,3600*unit);m,t=divmod(t,60*unit);sec,t=divmod(t,unit)
 return f'{h}:{m:02}:{sec:02}.{t:02}' if ass else f'{h:02}:{m:02}:{sec:02},{t:03}'
def chunks(text):
 result=[];current=[]
 for word in text.split():
  if current and (len(' '.join(current+[word]))>95 or len(current)>=18 or (len(' '.join(current))>65 and word.lower() in ['and','then','whether'])):result.append(' '.join(current));current=[]
  current.append(word)
  if re.search(r'[.!?]$',word) or (word.endswith(',') and len(current)>=8):result.append(' '.join(current));current=[]
 if current:result.append(' '.join(current))
 return result
def weight(text):return sum(max(1,len(re.findall(r'[aeiouy]+',w.lower())))+(.8 if re.search(r'[,.!?]$',w) else 0) for w in text.split())

for kind in ([os.environ['GAMEFRAME_VIDEO_KIND']] if os.environ.get('GAMEFRAME_VIDEO_KIND') else os.environ.get('GAMEFRAME_VIDEO_KINDS','overview,walkthrough').split(',')):
 folder=base/kind;story=json.loads((folder/'storyboard.json').read_text(encoding='utf-8'))
 narration=folder/'narration';narration.mkdir(exist_ok=True);captions=folder/'captions';captions.mkdir(exist_ok=True)
 cursor=0;srt=[];cue_count=0;all_voice=[]
 for index,scene in enumerate(story['scenes']):
  old=previous_by_text.get(scene['text']) if kind=='walkthrough' else None
  delay=scene.get('voice_delay_s',.2)
  if old:
   voice_duration=old['voice_duration_s'];delay=old['voice_delay_s'];normalized=None
  else:
   digest=hashlib.sha256((str(story['voice_scale'])+'|'+scene['text']).encode()).hexdigest()[:18]
   normalized=cache/f'{digest}-48k.wav'
   raw=cache/f'{digest}.wav'
   if not normalized.exists():
    if not raw.exists():
     if voice is None:voice=PiperVoice.load(str(root/'.tools/narration/voices/en_US-joe-medium.onnx'))
     with wave.open(str(raw),'wb') as w:voice.synthesize_wav(scene['text'],w,syn_config=SynthesisConfig(length_scale=story['voice_scale']))
    run(['-i',raw,'-af','loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000','-ac','1','-c:a','pcm_s16le',normalized])
   voice_duration=len(read(normalized))/48000
  if scene.get('source_video') and scene.get('source_duration_policy')!='narration':
   frames=math.ceil((scene['source_duration_s']-.00001)*30)
   if scene.get('allow_end_hold'):frames=max(frames,math.ceil((delay+voice_duration+.7)*30))
   assert delay+voice_duration+.1<=frames/30,(scene['title'],voice_duration)
  else:frames=math.ceil(max(scene.get('min_duration_s',4),delay+voice_duration+.7,len(scene['images'])*2.4)*30)
  samples=frames*1600
  if old:
   pcm=read(old['voice_wav']);pcm=np.pad(pcm,(0,max(0,samples-len(pcm))))[:samples]
  else:
   speech=read(normalized);lead=round(delay*48000);assert lead+len(speech)<=samples
   pcm=np.zeros(samples,dtype='<i2');pcm[lead:lead+len(speech)]=speech
  part=narration/f'scene-{index:02}.wav';write(part,pcm);all_voice.append(pcm)
  scene.update(index=index,frames=frames,start_s=cursor/30,end_s=(cursor+frames)/30,duration_s=frames/30,voice_delay_s=delay,voice_duration_s=voice_duration,voice_wav=str(part))
  pieces=chunks(scene['text']);weights=[weight(p) for p in pieces];elapsed=0;events=[]
  for piece,w in zip(pieces,weights):
   start=delay+elapsed/sum(weights)*voice_duration;elapsed+=w;end=delay+elapsed/sum(weights)*voice_duration;cue_count+=1
   lines=textwrap.wrap(piece,width=55);assert len(lines)<=2,(scene['title'],piece)
   safe='\\N'.join(lines).replace('{','').replace('}','')
   events.append(f'Dialogue: 0,{stamp(start,True)},{stamp(end,True)},Caption,,0,0,0,,{safe}')
   srt.append(f"{cue_count}\n{stamp(scene['start_s']+start)} --> {stamp(scene['start_s']+end)}\n"+'\n'.join(lines)+'\n')
  ass=captions/f'scene-{index:02}.ass';ass.write_text(header+'\n'.join(events)+'\n',encoding='utf-8');scene.update(caption_ass=str(ass),caption_sha256=hashlib.sha256(ass.read_bytes()).hexdigest())
  cursor+=frames;print(f"{kind.upper()} VOICE {index+1}/{len(story['scenes'])} {scene['title']}",flush=True)
 voice_pcm=np.concatenate(all_voice);voice_file=narration/'full-voiceover.wav';write(voice_file,voice_pcm)
 mixed=voice_pcm.astype(np.float32)/32768
 for scene in story['scenes']:
  if not(scene.get('source_video') and scene.get('source_has_audio')):continue
  file=narration/f"ambient-{scene['index']}.wav";samples=scene['frames']*1600
  run(['-i',scene['source_video'],'-vn','-af',f'aresample=48000,apad,atrim=end_sample={samples}','-ac','1','-c:a','pcm_s16le',file])
  sound=read(file).astype(np.float32)/32768;start=round(scene['start_s']*48000);mixed[start:start+len(sound)]+=sound*.20
 mixed*=min(1,.95/max(float(np.max(np.abs(mixed))),1e-9));soundtrack=narration/'full-video-soundtrack.wav';write(soundtrack,np.round(mixed*32767))
 mp3=root/'output/audio'/f"{story['output_basename']}-Voiceover.mp3";run(['-i',voice_file,'-c:a','libmp3lame','-b:a','160k',mp3])
 story.update(duration_s=cursor/30,total_frames=cursor,voiceover_wav=str(voice_file),video_soundtrack_wav=str(soundtrack),voiceover_mp3=str(mp3))
 (folder/'timed-storyboard.json').write_text(json.dumps(story,indent=2),encoding='utf-8');(folder/'voiceover.srt').write_text('\n'.join(srt),encoding='utf-8')
 print(json.dumps({'kind':kind,'duration_s':cursor/30,'scenes':len(story['scenes']),'caption_cues':cue_count}),flush=True)
