"""Generate continuous instruction paragraph WAVs locally with Kokoro af_heart.

No network requests are made. One worker reuses its model across the requested
remaining kinds with two ONNX threads. Existing matching paragraph WAVs cache.
Do not launch duplicate workers while remaining-kind batch mode is enabled.

  Python3.12 scripts/narrate-local-instructions.py --kind all --threads 2
"""
from __future__ import annotations
import argparse,hashlib,importlib.metadata,json,math,subprocess,sys,time,wave
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
LOCAL=ROOT/'.tools/narration-natural'
BASE=ROOT/'demo-output/instruction-continuous/narration'
sys.path.insert(0,str(LOCAL/'python'));sys.path.append(str(ROOT/'.tools/narration/python'))
RATE=48000;FPS=30;SPF=1600

def digest(file):
    h=hashlib.sha256()
    with Path(file).open('rb') as stream:
        while block:=stream.read(1024*1024):h.update(block)
    return h.hexdigest()

def read_wav(file):
    with wave.open(str(file),'rb') as stream:
        if (stream.getframerate(),stream.getnchannels(),stream.getsampwidth())!=(RATE,1,2):raise ValueError('Expected48k mono16bit WAV')
        return stream.readframes(stream.getnframes())

def write_wav(file,data,rate=RATE):
    with wave.open(str(file),'wb') as stream:
        stream.setnchannels(1);stream.setsampwidth(2);stream.setframerate(rate);stream.writeframes(data)

def complete_track(video,plan):
    path=BASE/video['kind']/'narration-manifest.json'
    try:
        data=json.loads(path.read_text(encoding='utf-8'))
        expected=json.loads((LOCAL/'provenance.json').read_text(encoding='utf-8'))['sha256']
        if data.get('voice')!='af_heart' or data.get('engine')!='kokoro-onnx' or len(data['paragraphs'])!=len(video['paragraphs']):return False
        for saved,current in zip(data['paragraphs'],video['paragraphs']):
            if saved['text']!=current['text'] or saved['voice']!='af_heart' or saved['speed']!=float(plan.get('speed',1.0)) or saved['model_sha256']!=expected:return False
            if digest(saved['wav'])!=saved['wav_sha256']:return False
        if digest(data['full_wav'])!=data['full_wav_sha256']:return False
        print(json.dumps({'kind':video['kind'],'cached_track':True,'duration_s':data['duration_s'],'manifest':str(path.resolve()),'wav':data['full_wav']}),flush=True)
        return True
    except (OSError,ValueError,KeyError,TypeError):return False

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--kind',required=True,choices=['overview','walkthrough','hit-timing','technical','all'])
    parser.add_argument('--threads',type=int,default=2)
    parser.add_argument('--resume',action='store_true',help='Clear a previous pause request after recording has finished')
    parser.add_argument('--plan',type=Path,default=BASE/'narration-plan.json')
    args=parser.parse_args()
    pause_file=BASE/'.pause-request'
    if args.resume and pause_file.exists():pause_file.unlink()
    if pause_file.exists():
        print('PAUSED: recording hold is active; use --resume after it finishes',flush=True);return
    plan=json.loads(args.plan.read_text(encoding='utf-8-sig'))
    order=plan.get('synthesis_batch_order',['overview','hit-timing','technical','walkthrough'])
    kinds=order if args.kind=='all' else (order[order.index(args.kind):] if plan.get('reuse_engine_for_remaining_kinds') else [args.kind])
    videos=[next(v for v in plan['videos'] if v['kind']==kind) for kind in kinds]
    videos=[video for video in videos if not complete_track(video,plan)]
    if not videos:return
    import numpy as np
    import onnxruntime as ort
    from kokoro_onnx import Kokoro
    voice='af_heart';speed=float(plan.get('speed',1.0))
    config=json.loads((LOCAL/'model-configuration.json').read_text(encoding='utf-8'))
    model=Path(config['model']);voices=Path(config['voices'])
    options=ort.SessionOptions();options.intra_op_num_threads=max(1,args.threads);options.inter_op_num_threads=1
    print(f'LOADING {args.kind} Kokoro af_heart with {args.threads} ONNX threads',flush=True)
    engine=Kokoro.from_session(ort.InferenceSession(str(model),sess_options=options,providers=['CPUExecutionProvider']),str(voices))
    model_sha=digest(model)
    for video in videos:
        kind=video['kind'];folder=BASE/kind;folder.mkdir(exist_ok=True)
        start=time.perf_counter();parts=[];cursor=0;audio=[];gap_frames=math.ceil(plan.get('paragraph_pause_s',.35)*FPS)
        for index,paragraph in enumerate(video['paragraphs']):
            stem=folder/f'paragraph-{index+1:02}';wav=stem.with_suffix('.wav');metadata=stem.with_suffix('.json')
            fingerprint=hashlib.sha256((model_sha+'|'+voice+'|'+str(speed)+'|'+paragraph['text']).encode()).hexdigest()
            result=None
            if metadata.exists() and wav.exists():
                saved=json.loads(metadata.read_text(encoding='utf-8'))
                if saved.get('fingerprint')==fingerprint and saved.get('wav_sha256')==digest(wav):result=saved
            if result is None:
                began=time.perf_counter()
                samples,native_rate=engine.create(paragraph['text'],voice=voice,speed=speed,lang='en-us')
                samples=np.asarray(samples)
                if samples.size==0 or not np.isfinite(samples).all():raise ValueError('Non-finite or empty synthesized audio')
                gain=min(1.,.95/max(float(np.max(np.abs(samples))),1e-9))
                native=stem.with_suffix('.native.wav');write_wav(native,np.round(samples*gain*32767).astype('<i2').tobytes(),native_rate)
                temp=stem.with_suffix('.tmp.wav')
                subprocess.run([str(ROOT/'node_modules/ffmpeg-static/ffmpeg.exe'),'-y','-v','error','-i',str(native),'-ac','1','-ar',str(RATE),'-c:a','pcm_s16le','-threads','1',str(temp)],check=True)
                pcm=read_wav(temp);speech_samples=len(pcm)//2;frames=math.ceil(speech_samples/SPF)
                pcm+=b'\0\0'*(frames*SPF-speech_samples);write_wav(wav,pcm);temp.unlink()
                values=np.frombuffer(pcm,dtype='<i2').astype(np.int32)
                clipped=int(np.count_nonzero(np.abs(values)>=32760));nonzero=int(np.count_nonzero(values))
                if clipped or not nonzero:raise ValueError('Waveform clipping or silence')
                result={'kind':kind,'index':index,'id':paragraph['id'],'text':paragraph['text'],'word_count':len(paragraph['text'].split()),'voice':voice,'speed':speed,'engine':'kokoro-onnx','engine_version':importlib.metadata.version('kokoro-onnx'),'model_file':str(model),'model_sha256':model_sha,'model_variant':'Kokoro82M v1.0 ONNX Community q8','remote_synthesis':False,'fingerprint':fingerprint,'wav':str(wav.resolve()),'wav_sha256':digest(wav),'sample_rate':RATE,'native_sample_rate':native_rate,'channels':1,'sample_width_bytes':2,'speech_duration_s':speech_samples/RATE,'duration_s':frames/FPS,'frames':frames,'samples':frames*SPF,'peak_pcm16':int(np.max(np.abs(values))),'clipped_sample_count':clipped,'nonzero_sample_count':nonzero,'gain':gain,'synthesis_elapsed_s':time.perf_counter()-began,'model_provenance':str((LOCAL/'provenance.json').resolve())}
                metadata.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
                print(f'READY {kind} {index+1}/{len(video["paragraphs"])} {result["duration_s"]:.3f}s',flush=True)
            else:print(f'CACHED {kind} {index+1}/{len(video["paragraphs"])}',flush=True)
            if pause_file.exists() and index<len(video['paragraphs'])-1:
                print(f'PAUSED after saved {kind} paragraph {index+1}; model released on exit',flush=True);return
            result=dict(result);result.update(start_s=cursor/FPS,end_s=(cursor+result['frames'])/FPS)
            parts.append(result);audio.append(read_wav(wav));cursor+=result['frames']
            if index<len(video['paragraphs'])-1:audio.append(b'\0\0'*(gap_frames*SPF));cursor+=gap_frames
        full=folder/'full-narration.wav';write_wav(full,b''.join(audio))
        manifest={'kind':kind,'title':video['title'],'voice':voice,'engine':'kokoro-onnx','remote_synthesis':False,'source_plan':str(args.plan.resolve()),'full_wav':str(full.resolve()),'full_wav_sha256':digest(full),'duration_s':cursor/FPS,'frames':cursor,'sample_rate':RATE,'channels':1,'sample_width_bytes':2,'paragraph_pause_s':gap_frames/FPS,'paragraphs':parts,'source_documents':plan['source_audit'],'model_provenance':str((LOCAL/'provenance.json').resolve()),'synthesis_script':str(Path(__file__).resolve()),'synthesis_elapsed_s':time.perf_counter()-start}
        (folder/'narration-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
        print(json.dumps({'kind':kind,'duration_s':cursor/FPS,'paragraphs':len(parts),'manifest':str((folder/'narration-manifest.json').resolve()),'wav':str(full.resolve())}),flush=True)
        if pause_file.exists():
            print(f'PAUSED after completed {kind}; model released on exit',flush=True);return

if __name__=='__main__':main()
