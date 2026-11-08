"""Read-only checks of approved Microsoft narration and exact timings."""
import argparse,hashlib,json,math,wave
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'demo-output/instruction-continuous/narration-microsoft';PLAN=ROOT/'demo-output/instruction-continuous/narration/narration-plan.json'

def sha(file):
    h=hashlib.sha256()
    with Path(file).open('rb') as stream:
        while block:=stream.read(1024*1024):h.update(block)
    return h.hexdigest()

def waveform(file,expected_frames):
    with wave.open(str(file),'rb') as stream:
        rate=stream.getframerate();channels=stream.getnchannels();width=stream.getsampwidth();samples=stream.getnframes();pcm=stream.readframes(samples)
    values=memoryview(pcm).cast('h');peak=max(abs(v) for v in values);nonzero=sum(v!=0 for v in values);clipped=sum(abs(v)>=32760 for v in values)
    checks={'mono_48k_16bit':(rate,channels,width)==(48000,1,2),'frame_exact':samples==expected_frames*1600,'nonzero_audio':nonzero>0,'no_clipping':clipped==0}
    return {'file':str(Path(file).resolve()),'samples':samples,'duration_s':samples/rate,'sample_rate':rate,'channels':channels,'sample_width_bytes':width,'peak_pcm16':peak,'nonzero_samples':nonzero,'clipped_samples':clipped,'checks':checks}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--kind',default='all');args=parser.parse_args()
    plan=json.loads(PLAN.read_text(encoding='utf-8'));kinds=[v['kind'] for v in plan['videos']] if args.kind=='all' else [args.kind]
    report_path=BASE/'audio-validation.json'
    existing=json.loads(report_path.read_text(encoding='utf-8')) if report_path.exists() else {'videos':[]}
    entries={v['kind']:v for v in existing['videos']}
    for kind in kinds:
        source=next(v for v in plan['videos'] if v['kind']==kind)
        file=BASE/kind/'narration-manifest.json';manifest=json.loads(file.read_text(encoding='utf-8'));issues=[];parts=[];cursor=0
        if len(source['paragraphs'])!=len(manifest['paragraphs']):issues.append('Paragraph count does not match canonical plan')
        for index,(expected,part) in enumerate(zip(source['paragraphs'],manifest['paragraphs'])):
            audio=waveform(part['wav'],part['frames'])
            checks={'text_matches_canonical_plan':part['text']==expected['text'],'id_matches_canonical_plan':part['id']==expected['id'],'approved_chosen_voice':part['engine']=='edge-tts' and part['voice']=='en-US-AndrewMultilingualNeural' and part['rate']=='-3%' and part['remote_synthesis'] is True,'hash_matches':sha(part['wav'])==part['wav_sha256'],'start_frame_exact':abs(part['start_s']-cursor/30)<1e-8,'end_frame_exact':abs(part['end_s']-(cursor+part['frames'])/30)<1e-8,'speech_fits':part['speech_duration_s']<=part['duration_s']+1e-8}
            for name,passed in {**checks,**audio['checks']}.items():
                if not passed:issues.append(f'Paragraph{index+1}: {name}')
            parts.append({'index':index,'id':part['id'],'audio':audio,'checks':checks});cursor+=part['frames']
            if index<len(manifest['paragraphs'])-1:cursor+=round(manifest['paragraph_pause_s']*30)
        full=waveform(manifest['full_wav'],manifest['frames'])
        checks={'total_frames_match':cursor==manifest['frames'],'total_duration_matches':abs(manifest['duration_s']-manifest['frames']/30)<1e-8,'full_hash_matches':sha(manifest['full_wav'])==manifest['full_wav_sha256']}
        for name,passed in {**checks,**full['checks']}.items():
            if not passed:issues.append(name)
        entries[kind]={'kind':kind,'status':'pass' if not issues else 'fail','manifest':str(file.resolve()),'duration_s':manifest['duration_s'],'paragraphs':parts,'full_audio':full,'checks':checks,'issues':issues}
    report={'status':'pass' if all(v['status']=='pass' for v in entries.values()) else 'fail','videos':list(entries.values()),'scope':'Read-only waveform/timing/text checks; narration and audio files are not modified.','canonical_plan':str(PLAN.resolve()),'authorization':'User explicitly approved the current canonical instructional script for Microsoft narration; no footage or personal data supplied','listening_note':'These checks establish artifact integrity, not subjective voice quality.'}
    report_path.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps({'status':report['status'],'videos':[(v['kind'],v['duration_s'],v['status']) for v in report['videos']],'report':str(report_path.resolve())}))
    if report['status']!='pass':raise SystemExit(1)

if __name__=='__main__':main()
