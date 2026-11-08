"""Local neural narration, timed to the tutorial scenes and existing output clips."""
import hashlib,json,math,subprocess,wave
from pathlib import Path
import numpy as np
import onnxruntime as ort
from piper import PiperVoice,SynthesisConfig

# Keep local inference from oversubscribing the workstation while encoding.
session_options_type=ort.SessionOptions
def bounded_session_options():
 options=session_options_type();options.intra_op_num_threads=2;options.inter_op_num_threads=1
 return options
ort.SessionOptions=bounded_session_options

root=Path(__file__).resolve().parents[1]
folder=root/'demo-output'/'cortland-double-85'
story=json.loads((folder/'storyboard.json').read_text(encoding='utf-8'))
narration=folder/'narration';narration.mkdir(exist_ok=True)
ffmpeg=root/'node_modules'/'ffmpeg-static'/'ffmpeg.exe'
voice_path=root/'.tools'/'narration'/'voices'/'en_US-joe-medium.onnx'
voice=PiperVoice.load(str(voice_path))
config=SynthesisConfig(length_scale=1.10)
def run(args):
 p=subprocess.run([str(ffmpeg),'-hide_banner','-loglevel','error','-y',*map(str,args)],capture_output=True)
 if p.returncode:raise RuntimeError(p.stderr.decode(errors='replace'))
def read_pcm(file):
 with wave.open(str(file),'rb') as w:
  assert w.getframerate()==48000 and w.getnchannels()==1 and w.getsampwidth()==2
  return np.frombuffer(w.readframes(w.getnframes()),dtype='<i2').copy()
def write_pcm(file,data):
 with wave.open(str(file),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(48000);w.writeframes(data.astype('<i2').tobytes())
scenes=story['scenes'];cursor_frames=0
for index,scene in enumerate(scenes):
 digest=hashlib.sha256((str(voice_path)+'|1.10|'+scene['text']).encode()).hexdigest()[:14]
 raw=narration/f'joe-{digest}.wav'
 if not raw.exists():
  with wave.open(str(raw),'wb') as w:voice.synthesize_wav(scene['text'],w,syn_config=config)
 with wave.open(str(raw),'rb') as w:voice_duration=w.getnframes()/w.getframerate()
 delay=float(scene.get('voice_delay_s',.20))
 if scene.get('source_video'):
  frames=math.ceil((float(scene['source_duration_s'])-0.00001)*30)
  if delay+voice_duration+.1>frames/30:raise ValueError(f"Narration exceeds source output: {scene['title']}")
 else:frames=math.ceil(max(delay+voice_duration+.65,len(scene['images'])*2.4,4)*30)
 duration=frames/30;samples=frames*1600
 padded=narration/f'scene-{index:02d}.wav'
 run(['-i',raw,'-af',f'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,adelay={round(delay*1000)}:all=1,apad,atrim=end_sample={samples}','-ac','1','-c:a','pcm_s16le',padded])
 pcm=read_pcm(padded);assert len(pcm)==samples
 scene.update(index=index,frames=frames,duration_s=duration,start_s=cursor_frames/30,end_s=(cursor_frames+frames)/30,voice_duration_s=voice_duration,voice_delay_s=delay,voice_wav=str(padded))
 cursor_frames+=frames
 print(f"VOICE {index+1}/{len(scenes)} {scene['title']} ({voice_duration:.1f}s)",flush=True)
voice_pcm=np.concatenate([read_pcm(s['voice_wav']) for s in scenes])
voice_file=narration/'full-voiceover.wav';write_pcm(voice_file,voice_pcm)
mixed=voice_pcm.astype(np.float32)/32768
for scene in scenes:
 if not(scene.get('source_video') and scene.get('source_has_audio')):continue
 source=narration/f"source-{scene['index']:02d}.wav";samples=scene['frames']*1600
 run(['-i',scene['source_video'],'-vn','-af',f'aresample=48000,apad,atrim=end_sample={samples}','-ac','1','-c:a','pcm_s16le',source])
 pcm=read_pcm(source).astype(np.float32)/32768
 start=round(scene['start_s']*48000);mixed[start:start+len(pcm)]+=pcm*.25
gain=min(1,.95/max(float(np.max(np.abs(mixed))),1e-9));mixed*=gain
mix_file=narration/'full-video-soundtrack.wav';write_pcm(mix_file,np.round(mixed*32767))
output=root/'output'/'audio';output.mkdir(parents=True,exist_ok=True)
mp3=output/'Cortland-Double-Voiceover.mp3'
run(['-i',voice_file,'-c:a','libmp3lame','-b:a','192k','-ar','48000','-ac','1',mp3])
story.update(voice='en_US-joe-medium',voice_model=str(voice_path),voice_dataset_license='CC0 (upstream model card)',duration_s=cursor_frames/30,total_frames=cursor_frames,voiceover_wav=str(voice_file),video_soundtrack_wav=str(mix_file),voiceover_mp3=str(mp3),audio_mix_gain=gain)
(folder/'timed-storyboard.json').write_text(json.dumps(story,indent=2),encoding='utf-8')
def stamp(seconds):
 ms=round(seconds*1000);h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000);return f'{h:02}:{m:02}:{s:02},{ms:03}'
srt=[]
for i,s in enumerate(scenes,1):srt.append(f"{i}\n{stamp(s['start_s']+s['voice_delay_s'])} --> {stamp(s['start_s']+s['voice_delay_s']+s['voice_duration_s'])}\n{s['text']}\n")
(folder/'voiceover.srt').write_text('\n'.join(srt),encoding='utf-8')
print(json.dumps({'mp3':str(mp3),'duration_s':story['duration_s'],'scenes':len(scenes),'peak':float(np.max(np.abs(mixed)))}))
