"""Apply visual-only finishing and validate the dated video storyboards."""
import hashlib,json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
base=root/'demo-output/gameframe-20261106'
for kind in ['overview','walkthrough','technical','hit-timing']:
    file=base/kind/'timed-storyboard.json'
    if not file.exists():continue
    story=json.loads(file.read_text())
    for index,scene in enumerate(story['scenes']):
        assert not any(word in scene['text'].lower() for word in ['cortland','half-frame precision','keep uncertainty in mind'])
        if scene['title'] in ['Keep moving','Save and continue into timing']:
            scene['image_crop']=[720,430,550,285]
        if scene['title']=='Review the modeled result':scene['image_crop']=[1280,530,0,0]
        scene['image_sha256']=[hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in scene['images']]
        if kind=='walkthrough':
            scene['chapter']=('Start here' if index==0 else 'Measure a hit' if index<=11 else 'Tag swing timing' if index<=14 else 'Measure a pitch' if index<=17 else 'Create a matchup' if index<=19 else 'View the finished EV video' if index==20 else 'Follow the guided prompts')
        captions=Path(scene['caption_ass']).read_text()
        assert sum(line.startswith('Style: ') for line in captions.splitlines())==1
        events=[]
        def seconds(t):
            h,m,s=map(float,t.split(':'));return h*3600+m*60+s
        for line in captions.splitlines():
            if line.startswith('Dialogue: '):
                parts=line.split(',',9);events.append((seconds(parts[1]),seconds(parts[2])))
        assert all(a[1]<=b[0]+.011 for a,b in zip(events,events[1:])),scene['title']
        assert all(0<=start<end<=scene['duration_s']+.02 for start,end in events)
    story['expected_chapter_count']=sum(i==0 or s['chapter']!=story['scenes'][i-1]['chapter'] for i,s in enumerate(story['scenes']))
    file.write_text(json.dumps(story,indent=2))
    print(json.dumps({'kind':kind,'seconds':story['duration_s'],'scenes':len(story['scenes']),'caption_layers':1,'chapters':story['expected_chapter_count']}))
