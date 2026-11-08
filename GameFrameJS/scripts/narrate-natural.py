"""Local Kokoro narration, using repository-local models and dependencies.

Python 3.12:
  python scripts/narrate-natural.py --samples
  python scripts/narrate-natural.py --voice af_heart --text-file narration.txt --out narration.wav

Synthesizes each supplied passage as a complete utterance rather than resetting
prosody sentence by sentence. No network or paid service is used at synthesis.
Setup assets/provenance are in .tools/narration-natural/.
"""
from __future__ import annotations
import argparse,hashlib,importlib.metadata,json,os,subprocess,sys,time,wave
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
LOCAL=ROOT/'.tools/narration-natural'
sys.path.insert(0,str(LOCAL/'python'))
sys.path.append(str(ROOT/'.tools/narration/python'))

SAMPLE_TEXT='Start by choosing the video you want to measure. Now check the contact frame. If the ball falls between two frames, choose Between frames and mark the first frame after contact. Take a moment to check the field marks before you continue.'


def digest(path):
    result=hashlib.sha256()
    with Path(path).open('rb') as stream:
        while block:=stream.read(1024*1024):result.update(block)
    return result.hexdigest()


def write_native(file,samples,rate):
    import numpy as np
    if samples.size==0 or not np.isfinite(samples).all():raise ValueError('Synthesized audio is empty or non-finite')
    peak=float(np.max(np.abs(samples)))
    gain=min(1.,.95/max(peak,1e-9))
    pcm=np.round(samples*gain*32767).astype('<i2')
    with wave.open(str(file),'wb') as stream:
        stream.setnchannels(1);stream.setsampwidth(2);stream.setframerate(rate);stream.writeframes(pcm.tobytes())
    return peak,gain


def synthesize(engine,text,voice,speed,output,rate=48000):
    import numpy as np
    start=time.perf_counter()
    samples,native_rate=engine.create(text,voice=voice,speed=speed,lang='en-us')
    output=Path(output).resolve();output.parent.mkdir(parents=True,exist_ok=True)
    native=output.with_suffix('.native.wav') if rate!=native_rate else output
    peak,gain=write_native(native,np.asarray(samples),native_rate)
    if native!=output:
        ffmpeg=ROOT/'node_modules/ffmpeg-static/ffmpeg.exe'
        subprocess.run([str(ffmpeg),'-y','-v','error','-i',str(native),'-ar',str(rate),'-ac','1','-c:a','pcm_s16le',str(output)],check=True)
    with wave.open(str(output),'rb') as stream:
        actual_rate=stream.getframerate();count=stream.getnframes()
        pcm=np.frombuffer(stream.readframes(count),dtype='<i2').astype(np.int32)
    result={'engine':'kokoro-onnx','engine_version':importlib.metadata.version('kokoro-onnx'),'model':'Kokoro82M v1.0 ONNX','voice':voice,'language':'en-us','speed':speed,'text':text,'wav':str(output),'sha256':digest(output),'sample_rate':actual_rate,'native_sample_rate':native_rate,'channels':1,'sample_width_bytes':2,'samples':count,'duration_s':count/actual_rate,'elapsed_s':time.perf_counter()-start,'peak_before_gain':peak,'gain':gain,'peak_pcm16':int(np.max(np.abs(pcm))),'clipped_sample_count':int(np.count_nonzero(np.abs(pcm)>=32760)),'nonzero_sample_count':int(np.count_nonzero(pcm)),'model_provenance':str((LOCAL/'provenance.json').resolve()),'synthesis_network_calls':False}
    if result['nonzero_sample_count']==0 or result['clipped_sample_count']:raise ValueError('Synthesized audio failed waveform checks')
    output.with_suffix('.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result),flush=True)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    source=parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--samples',action='store_true')
    source.add_argument('--text')
    source.add_argument('--text-file',type=Path)
    parser.add_argument('--voice',default='af_heart')
    parser.add_argument('--speed',type=float,default=1.0)
    parser.add_argument('--out',type=Path)
    parser.add_argument('--rate',type=int,default=48000)
    parser.add_argument('--threads',type=int,default=2)
    args=parser.parse_args()
    if not args.samples and args.out is None:parser.error('--out is required for custom narration')
    import onnxruntime as ort
    from kokoro_onnx import Kokoro
    models=LOCAL/'models';config_file=LOCAL/'model-configuration.json';config=json.loads(config_file.read_text(encoding='utf-8')) if config_file.exists() else {};model=Path(config.get('model',models/'kokoro-v1.0.onnx'));voices=Path(config.get('voices',models/'voices-v1.0.bin'))
    if not model.exists() or not voices.exists():raise FileNotFoundError('Run .tools/narration-natural/fetch_q8.py first')
    opts=ort.SessionOptions();opts.intra_op_num_threads=max(1,args.threads);opts.inter_op_num_threads=1
    engine=Kokoro.from_session(ort.InferenceSession(str(model),sess_options=opts,providers=['CPUExecutionProvider']),str(voices))
    if args.samples:
        folder=ROOT/'demo-output/instruction-continuous/audio-samples'
        results=[synthesize(engine,SAMPLE_TEXT,voice,1.0,folder/f'kokoro-{voice}.wav',args.rate) for voice in ['af_heart','am_michael']]
        (folder/'samples.json').write_text(json.dumps({'samples':results,'comparison':'Different Kokoro voices; these samples use no Piper audio.','quality_review':'Listen to both samples before selecting a narration voice.'},indent=2)+'\n',encoding='utf-8')
    else:
        text=args.text if args.text is not None else args.text_file.read_text(encoding='utf-8-sig')
        synthesize(engine,text,args.voice,args.speed,args.out,args.rate)


if __name__=='__main__':main()
