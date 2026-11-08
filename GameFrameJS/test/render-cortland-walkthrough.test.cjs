const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const renderer = require('../scripts/render-cortland-walkthrough.cjs');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('scene jobs overlap within their limit and preserve playback order', async () => {
  let active = 0, peak = 0;
  const finished = [];
  const result = await renderer.mapConcurrent([0, 1, 2, 3, 4, 5], 4, async index => {
    active++;
    peak = Math.max(peak, active);
    await delay(index === 0 ? 60 : 5);
    finished.push(index);
    active--;
    return `scene-${index}`;
  });
  assert.equal(peak, 4);
  assert.notEqual(finished[0], 0);
  assert.deepEqual(result, [0, 1, 2, 3, 4, 5].map(index => `scene-${index}`));
});

test('failed encodes settle active jobs and never start queued jobs', async () => {
  const started = [], settled = [];
  await assert.rejects(renderer.mapConcurrent([0, 1, 2, 3], 2, async index => {
    started.push(index);
    if (index === 0) throw new Error('encode failed');
    await delay(20);
    settled.push(index);
  }), /encode failed/);
  assert.deepEqual(started, [0, 1]);
  assert.deepEqual(settled, [1]);
});

test('phone crops accept scene defaults, per-image arrays and image overrides', () => {
  assert.deepEqual(renderer.imageCrop({title:'Choose the original video'}, 'image.png', 0, false), [1000,650,220,120]);
  assert.equal(renderer.imageCrop({title:'Choose the original video'}, 'image.png', 0, true), undefined);
  const scene = {title:'Tag ball', image_crop:[[400,225,0,0],[600,338,100,50]]};
  assert.deepEqual(renderer.imageCrop(scene,'image.png',1,true), [600,338,100,50]);
  assert.deepEqual(renderer.imageCrop(scene,{path:'image.png',image_crop:[320,180,20,40]},1,true), [320,180,20,40]);
  assert.throws(() => renderer.imageCrop({title:'Bad crop',image_crop:[0,100,0,0]},'image.png',0,true),/Invalid image_crop/);
});

test('phone screenshots reserve120 pixels for narration while desktop framing is unchanged', () => {
  const scene={title:'Review',images:['image.png']};
  const phone=renderer.imageLayout({phone_framing:true,captioned:true},scene,'image.png',0,'label.txt');
  const desktop=renderer.imageLayout({captioned:true},scene,'image.png',0,'label.txt');
  assert.match(phone,/scale=1280:600:/);
  assert.match(phone,/drawbox=x=0:y=600:w=1280:h=120:/);
  assert.match(desktop,/scale=1280:654:/);
  assert.match(desktop,/drawbox=x=0:y=654:w=1280:h=66:/);
});
test('encoding cache changes for phone framing, crops, layout and screenshot bytes', () => {
  const scene = {title:'Ball',images:['image.png'],frames:30,image_crop:[400,225,0,0]};
  const base = renderer.frameKey({},scene,[['image.png','first image']]);
  assert.notEqual(base,renderer.frameKey({phone_framing:true},scene,[['image.png','first image']]));
  assert.notEqual(base,renderer.frameKey({}, {...scene,image_crop:[300,169,20,20]}, [['image.png','first image']]));
  assert.notEqual(base,renderer.frameKey({},scene,[['image.png','changed image']]));
  assert.equal(base,renderer.frameKey({}, {...scene,text:'new narration',voice_delay_s:1.2}, [['image.png','first image']]));
  assert.ok(renderer.LAYOUT_REVISION >= 6);
});

function command(binary,args) {
  const result = spawnSync(binary,args,{windowsHide:true,encoding:'utf8',maxBuffer:4*1024*1024});
  assert.equal(result.status,0,result.stderr);
  return result.stdout;
}

test('real phone-framed render preserves image order, narration, chapters and cache boundaries', {timeout:300000}, async () => {
  const ffmpeg = require('ffmpeg-static'), ffprobe = require('ffprobe-static').path;
  const folder = fs.mkdtempSync(path.join(os.tmpdir(),'walkthrough-render-'));
  try {
    const source = path.join(folder,'capture.ppm');
    const pixels = Buffer.alloc(960*540*3);
    for (let y=0;y<540;y++) for (let x=0;x<960;x++) pixels[(y*960+x)*3+(x<480?0:2)]=240;
    fs.writeFileSync(source,Buffer.concat([Buffer.from('P6\n960 540\n255\n'),pixels]));
    const soundtrack = path.join(folder,'voice.wav');
    command(ffmpeg,['-y','-v','error','-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=1.2','-c:a','pcm_s16le',soundtrack]);
    fs.writeFileSync(path.join(folder,'voiceover.srt'),'1\n00:00:00,000 --> 00:00:01,200\nTag the ball.\n');
    const story = {phone_framing:true,burn_narration_captions:false,duration_s:1.2,video_soundtrack_wav:soundtrack,output_basename:'phone-test',scenes:[
      {index:0,title:'Two views',chapter:'Mark the ball',start_s:0,end_s:.8,duration_s:.8,frames:24,images:[source,source],image_crop:[[480,270,0,0],[480,270,480,0]]},
      {index:1,title:'Review',chapter:'Review marks',start_s:.8,end_s:1.2,duration_s:.4,frames:12,images:[{path:source,image_crop:[480,270,0,0]}]},
    ]};
    const storyboard = path.join(folder,'timed-storyboard.json');
    fs.writeFileSync(storyboard,JSON.stringify(story));
    const outputDir = path.join(folder,'out');
    let active=0,peak=0;
    const before = process.cwd();
    const report = await renderer.renderStoryboard({folder,outputDir,concurrency:4,onSceneStart(){active++;peak=Math.max(peak,active);},onSceneComplete(){active--;}});
    assert.equal(process.cwd(),before);
    assert.equal(peak,2);
    assert.equal(report.phone_framing,true);
    assert.equal(report.render_concurrency,4);
    const info = JSON.parse(command(ffprobe,['-v','error','-show_streams','-show_chapters','-show_format','-of','json',report.video]));
    const video = info.streams.find(stream=>stream.codec_type==='video');
    const audio = info.streams.find(stream=>stream.codec_type==='audio');
    assert.equal(Number(video.nb_frames),36);
    assert.equal(video.width,1280); assert.equal(video.height,720);
    assert.ok(audio); assert.equal(Number(audio.sample_rate),48000);
    assert.equal(info.chapters.length,2);
    assert.equal(info.chapters[0].tags.title,'Mark the ball');
    assert.equal(info.chapters[1].tags.title,'Review marks');
    assert.ok(Math.abs(Number(info.chapters[1].start_time)-.8)<.001);
    assert.equal(fs.readFileSync(path.join(outputDir,'phone-test.srt'),'utf8'),fs.readFileSync(path.join(folder,'voiceover.srt'),'utf8'));
    for (const [time,channel] of [[.2,0],[.6,2],[1,0]]) {
      const raw = spawnSync(ffmpeg,['-v','error','-ss',String(time),'-i',report.video,'-frames:v','1','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{windowsHide:true});
      assert.equal(raw.status,0,raw.stderr.toString());
      assert.ok(raw.stdout[channel]>180,`Wrong crop/image at ${time}s: ${[...raw.stdout]}`);
      assert.ok(raw.stdout[(channel+2)%3]<40);
    }
    const cached = [];
    await renderer.renderStoryboard({folder,outputDir,onSceneComplete(scene,cache){cached.push(cache);}});
    assert.deepEqual(cached,[true,true]);
    const sceneCache = JSON.parse(fs.readFileSync(path.join(folder,'render','scene-00.mp4.json')));
    assert.equal(sceneCache.phone_framing,true);
    assert.equal(sceneCache.revision,renderer.LAYOUT_REVISION);
  } finally {
    fs.rmSync(folder,{recursive:true,force:true});
  }
});

test('precomposed_frames bypasses image-layout FFmpeg jobs and keeps narration overlay', async () => {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'walkthrough-precomposed-'));
  try {
    const image=path.join(folder,'precomposed.png');
    const header=Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(header);
    header.writeUInt32BE(1280,16); header.writeUInt32BE(720,20); fs.writeFileSync(image,header);
    assert.equal(renderer.validatePrecomposedFrame(image),image);
    const invalid=path.join(folder,'invalid.png'); header.writeUInt32BE(654,20);fs.writeFileSync(invalid,header);
    assert.throws(()=>renderer.validatePrecomposedFrame(invalid),/1280x720 PNG/);
    const caption=path.join(folder,'caption.ass');fs.writeFileSync(caption,'real caption file');
    const story={precomposed_frames:true,phone_framing:true,captioned:true,duration_s:1,video_soundtrack_wav:'voice.wav',output_basename:'prepared',scenes:[
      {index:0,title:'Prepared scene',chapter:'Prepared',start_s:0,end_s:1,frames:30,duration_s:1,images:[image],caption_ass:caption},
    ]};
    fs.writeFileSync(path.join(folder,'timed-storyboard.json'),JSON.stringify(story));
    const calls=[];
    await renderer.renderStoryboard({folder,outputDir:path.join(folder,'out'),ffmpeg:'mock-ffmpeg',ffprobe:'mock-probe',execute:async(binary,args)=>{
      if(binary==='mock-probe')return JSON.stringify({format:{duration:'1'},streams:[{codec_type:'video',nb_frames:'30'}]});
      calls.push(args);fs.writeFileSync(args.at(-1),'encoded');return '';
    }});
    assert.equal(calls.length,2,'Only scene encoding and final assembly should invoke FFmpeg');
    assert.equal(calls[0][calls[0].indexOf('-i')+1],image);
    assert.match(calls[0][calls[0].indexOf('-vf')+1],/ass=filename=captions-0.ass/);
    assert.doesNotMatch(calls[0][calls[0].indexOf('-vf')+1],/scale=|crop=|drawbox=/);
    assert.notEqual(renderer.frameKey(story,story.scenes[0],[]),renderer.frameKey({...story,precomposed_frames:false},story.scenes[0],[]));
  }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
