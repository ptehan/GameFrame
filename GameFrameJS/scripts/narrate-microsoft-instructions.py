"""Microsoft Andrew narration of the explicitly approved canonical instructions.

Use only after the user approves sending the current narration-plan.json text to
Microsoft's speech service. It sends paragraph text, voice and rate only; no
footage, names, addresses, account information or local file paths are uploaded.
Existing output caches are independent of the local Kokoro tracks.
"""
from __future__ import annotations
import argparse,asyncio,hashlib,importlib.metadata,inspect,json,math,sys,time,wave
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.tools/narration-natural/python'))
PLAN=ROOT/'demo-output/instruction-continuous/narration/narration-plan.json'
BASE=ROOT/'demo-output/instruction-continuous/narration-microsoft'
RATE=48000;FPS=30;SPF=1600;VOICE='en-US-AndrewMultilingualNeural';SPEECH_RATE='-3%'

def sha(file):
    h=hashlib.sha256()
    with Path(file).open('rb') as stream:
        while block:=stream.read(1024*1024):h.update(block)
    return h.hexdigest()

def read_wave(file):
    with wave.open(str(file),'rb') as stream:
        if (stream.getframerate(),stream.getnchannels(),stream.getsampwidth())!=(RATE,1,2):raise ValueError('Expected48k mono16bit WAV')
        return stream.readframes(stream.getnframes())

def write_wave(file,pcm):
    with wave.open(str(file),'wb') as stream:
        stream.setnchannels(1);stream.setsampwidth(2);stream.setframerate(RATE);stream.writeframes(pcm)

async def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--approved-microsoft-narration',action='store_true',required=True)
    parser.add_argument('--plan',type=Path,default=PLAN)
    parser.add_argument('--kinds',default='overview,hit-timing,technical,walkthrough')
    parser.add_argument('--concurrency',type=int,default=4)
    args=parser.parse_args()
    import edge_tts
    plan=json.loads(args.plan.read_text(encoding='utf-8-sig'));plan_sha=sha(args.plan)
    kinds=args.kinds.split(',');videos=[next(v for v in plan['videos'] if v['kind']==kind) for kind in kinds]
    BASE.mkdir(parents=True,exist_ok=True)
    semaphore=asyncio.Semaphore(max(1,min(args.concurrency,4)))
    version=importlib.metadata.version('edge-tts');start=time.perf_counter();summaries=[];errors=[]

    async def paragraph_audio(video,index,paragraph):
        kind=video['kind'];folder=BASE/kind;folder.mkdir(exist_ok=True)
        stem=folder/f'paragraph-{index+1:02}';wav=stem.with_suffix('.wav');mp3=stem.with_suffix('.mp3');metadata=stem.with_suffix('.json')
        key=hashlib.sha256(('edge-tts|'+version+'|'+VOICE+'|'+SPEECH_RATE+'|'+paragraph['text']).encode()).hexdigest()
        if metadata.exists() and wav.exists():
            cached=json.loads(metadata.read_text(encoding='utf-8'))
            if cached.get('fingerprint')==key and cached.get('wav_sha256')==sha(wav):
                print(f'CACHED {kind} {index+1}/{len(video["paragraphs"])}',flush=True);return cached
        async with semaphore:
            for attempt in range(3):
                try:
                    began=time.perf_counter();partial=mp3.with_suffix('.mp3.partial');boundaries=[]
                    options={'rate':SPEECH_RATE}
                    if 'boundary' in inspect.signature(edge_tts.Communicate).parameters:options['boundary']='WordBoundary'
                    speech=edge_tts.Communicate(paragraph['text'],VOICE,**options)
                    async def receive():
                        with partial.open('wb') as stream:
                            async for chunk in speech.stream():
                                if chunk['type']=='audio':stream.write(chunk['data'])
                                elif chunk['type'] in ['WordBoundary','SentenceBoundary']:
                                    boundaries.append({'type':chunk['type'],'start_s':chunk['offset']/10000000,'duration_s':chunk['duration']/10000000,'text':chunk['text']})
                    await asyncio.wait_for(receive(),timeout=120);partial.replace(mp3)
                    temp=stem.with_suffix('.tmp.wav')
                    process=await asyncio.create_subprocess_exec(str(ROOT/'node_modules/ffmpeg-static/ffmpeg.exe'),'-y','-v','error','-i',str(mp3),'-ac','1','-ar',str(RATE),'-c:a','pcm_s16le','-threads','1',str(temp),stdout=asyncio.subprocess.DEVNULL,stderr=asyncio.subprocess.PIPE)
                    _,stderr=await process.communicate()
                    if process.returncode:raise RuntimeError(stderr.decode(errors='replace'))
                    pcm=read_wave(temp);speech_samples=len(pcm)//2;frames=math.ceil(speech_samples/SPF)
                    pcm+=b'\0\0'*(frames*SPF-speech_samples);write_wave(wav,pcm);temp.unlink()
                    values=memoryview(pcm).cast('h');peak=max(abs(v) for v in values);nonzero=sum(v!=0 for v in values);clipped=sum(abs(v)>=32760 for v in values)
                    if not nonzero or clipped:raise ValueError(f'Invalid waveform: nonzero={nonzero},clipped={clipped}')
                    result={'kind':kind,'index':index,'id':paragraph['id'],'text':paragraph['text'],'word_count':len(paragraph['text'].split()),'voice':VOICE,'rate':SPEECH_RATE,'engine':'edge-tts','engine_version':version,'remote_synthesis':True,'service':'Microsoft Edge online speech service','fingerprint':key,'wav':str(wav.resolve()),'mp3':str(mp3.resolve()),'wav_sha256':sha(wav),'sample_rate':RATE,'channels':1,'sample_width_bytes':2,'speech_duration_s':speech_samples/RATE,'duration_s':frames/FPS,'frames':frames,'samples':frames*SPF,'peak_pcm16':peak,'clipped_sample_count':clipped,'nonzero_sample_count':nonzero,'boundaries':boundaries,'synthesis_elapsed_s':time.perf_counter()-began,'authorization':'User explicitly approved current canonical instructional narration: Allow Microsoft narration','privacy_scope':plan['privacy_scope']}
                    metadata.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
                    print(f'READY {kind} {index+1}/{len(video["paragraphs"])} {frames/FPS:.3f}s',flush=True);return result
                except Exception as exc:
                    if attempt==2:raise
                    print(f'RETRY {kind} {index+1}: {exc}',flush=True);await asyncio.sleep(2*(attempt+1))

    async def video_audio(video):
        try:
            parts=await asyncio.gather(*(paragraph_audio(video,i,p) for i,p in enumerate(video['paragraphs'])))
            cursor=0;audio=[];paragraphs=[];gap_frames=math.ceil(plan.get('paragraph_pause_s',.35)*FPS)
            for index,part in enumerate(parts):
                part=dict(part);part.update(start_s=cursor/FPS,end_s=(cursor+part['frames'])/FPS)
                paragraphs.append(part);audio.append(read_wave(part['wav']));cursor+=part['frames']
                if index<len(parts)-1:audio.append(b'\0\0'*(gap_frames*SPF));cursor+=gap_frames
            folder=BASE/video['kind'];full=folder/'full-narration.wav';write_wave(full,b''.join(audio))
            manifest={'kind':video['kind'],'title':video['title'],'voice':VOICE,'rate':SPEECH_RATE,'engine':'edge-tts','engine_version':version,'remote_synthesis':True,'source_plan':str(args.plan.resolve()),'source_plan_sha256':plan_sha,'full_wav':str(full.resolve()),'full_wav_sha256':sha(full),'duration_s':cursor/FPS,'frames':cursor,'sample_rate':RATE,'channels':1,'sample_width_bytes':2,'paragraph_pause_s':gap_frames/FPS,'paragraphs':paragraphs,'source_documents':plan['source_audit'],'authorization':'User explicitly approved current canonical instructional narration: Allow Microsoft narration','privacy_scope':plan['privacy_scope'],'synthesis_script':str(Path(__file__).resolve())}
            path=folder/'narration-manifest.json';path.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
            summary={'kind':video['kind'],'duration_s':cursor/FPS,'paragraphs':len(parts),'manifest':str(path.resolve()),'wav':str(full.resolve())};summaries.append(summary);print(json.dumps(summary),flush=True)
        except Exception as exc:
            errors.append({'kind':video['kind'],'error':str(exc)});print(f'ERROR {video["kind"]}: {exc}',flush=True)
    await asyncio.gather(*(video_audio(v) for v in videos))
    (BASE/'synthesis-report.json').write_text(json.dumps({'summaries':summaries,'errors':errors,'elapsed_s':time.perf_counter()-start,'voice':VOICE,'rate':SPEECH_RATE,'concurrency':min(args.concurrency,4),'authorization':'User explicitly approved Microsoft narration of the current canonical script','source_plan_sha256':plan_sha},indent=2)+'\n',encoding='utf-8')
    if errors:raise RuntimeError(json.dumps(errors))

if __name__=='__main__':asyncio.run(main())
