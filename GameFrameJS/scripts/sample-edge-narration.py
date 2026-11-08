"""Optional online fallback samples; only this fixed, nonpersonal passage is sent."""
import asyncio,hashlib,importlib.metadata,json,subprocess,sys,time,wave
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.tools/narration-natural/python'))
TEXT='Start by choosing the video you want to measure. Now check the contact frame. If the ball falls between two frames, choose Between frames and mark the first frame after contact. Take a moment to check the field marks before you continue.'

async def sample(voice):
    import edge_tts
    folder=ROOT/'demo-output/instruction-continuous/audio-samples';folder.mkdir(parents=True,exist_ok=True)
    short=voice.replace('en-US-','');mp3=folder/f'edge-{short}.mp3';wav=mp3.with_suffix('.wav')
    start=time.perf_counter()
    await asyncio.wait_for(edge_tts.Communicate(TEXT,voice,rate='-3%').save(str(mp3)),timeout=90)
    subprocess.run([str(ROOT/'node_modules/ffmpeg-static/ffmpeg.exe'),'-y','-v','error','-i',str(mp3),'-ac','1','-ar','48000','-c:a','pcm_s16le',str(wav)],check=True)
    with wave.open(str(wav),'rb') as stream:rate=stream.getframerate();count=stream.getnframes()
    result={'engine':'edge-tts','engine_version':importlib.metadata.version('edge-tts'),'project':'https://github.com/rany2/edge-tts','wrapper_license':'LGPL-3.0','service':'Microsoft Edge online speech service','remote_synthesis':True,'voice':voice,'rate':'-3%','text':TEXT,'wav':str(wav),'mp3':str(mp3),'sha256':hashlib.sha256(wav.read_bytes()).hexdigest(),'duration_s':count/rate,'sample_rate':rate,'elapsed_s':time.perf_counter()-start,'privacy_scope':'Only the fixed generic passage in this file was sent. No user media, personal data, API key or account was supplied.'}
    wav.with_suffix('.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps(result),flush=True)
    return result

async def main():
    results=await asyncio.gather(*(sample(voice) for voice in ['en-US-AndrewMultilingualNeural','en-US-AvaMultilingualNeural']),return_exceptions=True)
    errors=[str(r) for r in results if isinstance(r,Exception)]
    (ROOT/'demo-output/instruction-continuous/audio-samples/edge-samples.json').write_text(json.dumps({'samples':[r for r in results if not isinstance(r,Exception)],'errors':errors},indent=2)+'\n')
    if errors:raise RuntimeError('; '.join(errors))

if __name__=='__main__':asyncio.run(main())
