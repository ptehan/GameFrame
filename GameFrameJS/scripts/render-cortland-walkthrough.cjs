const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
// Increment when the screenshot layout or encoding changes; phone crops must never
// reuse an older desktop render, even when the storyboard filenames stay the same.
const LAYOUT_REVISION = 8;
const quoted = file => "'" + file.replaceAll('\\', '/').replaceAll("'", "'\\''") + "'";

function execute(binary, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args.map(String), {cwd, windowsHide: true});
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-8 * 1024 * 1024); });
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) reject(new Error(stderr || `${path.basename(binary)} exited with ${code}`));
      else resolve(stdout);
    });
  });
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0, failure;
  async function consume() {
    while (!failure && next < items.length) {
      const index = next++;
      try { results[index] = await worker(items[index], index); }
      catch (error) { failure ||= error; }
    }
  }
  // Wait for running encoders to settle before cleanup/assembly can begin.
  await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, consume));
  if (failure) throw failure;
  return results;
}

function imageInput(image) {
  if (typeof image === 'string') return image;
  const file = image && (image.path || image.image || image.src);
  if (typeof file !== 'string') throw new Error('Each scene image needs a file path');
  return file;
}

function imageCrop(scene, image, index, phoneFraming) {
  let crop;
  if (image && typeof image === 'object' && !Array.isArray(image)) crop = image.image_crop || image.crop;
  if (!crop && scene.image_crop) {
    crop = Array.isArray(scene.image_crop[0]) || scene.image_crop[0] === null
      ? scene.image_crop[index] : scene.image_crop;
  }
  if (!crop && !phoneFraming) {
    if (['Choose the original video', 'Choose the pitch video', 'Team and pitcher', 'Clip start'].includes(scene.title)) {
      crop = scene.title === 'Choose the original video' ? [1000, 650, 220, 120] : [900, 650, 0, 0];
    }
    if (scene.title === 'Ground-contact visibility') crop = [900, 550, 270, 170];
    if (['Choose the saved pitch', 'Choose the saved swing', 'Create the matchup'].includes(scene.title)) crop = [1100, 760, 170, 0];
  }
  if (crop && (!Array.isArray(crop) || crop.length !== 4 || !crop.every(Number.isFinite)
      || crop[0] <= 0 || crop[1] <= 0 || crop[2] < 0 || crop[3] < 0)) {
    throw new Error(`Invalid image_crop for ${scene.title}, image ${index + 1}; use [width,height,x,y]`);
  }
  return crop;
}

function imageLayout(story, scene, image, index, label) {
  const crop = imageCrop(scene, image, index, !!story.phone_framing);
  const prefix = crop ? 'crop=' + crop.join(':') + ',' : '';
  if (story.burn_narration_captions === false) {
    return prefix + 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0xf1f6f2';
  }
  const pictureHeight = story.phone_framing ? 600 : 654;
  return prefix + 'scale=1280:' + pictureHeight + ':force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:0:color=0xf2f5f2,drawbox=x=0:y=' + pictureHeight + ':w=1280:h=' + (720-pictureHeight) + ':color=0x0b4d3a:t=fill'
    + (story.captioned ? '' : ',drawtext=fontfile=font.ttf:textfile=' + label + ':fontcolor=white:fontsize=21:line_spacing=2:x=34:y=662');
}

function validatePrecomposedFrame(file) {
  const header = Buffer.alloc(24), handle = fs.openSync(file, 'r');
  try { fs.readSync(handle, header, 0, 24, 0); } finally { fs.closeSync(handle); }
  if (!header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      || header.readUInt32BE(16) !== 1280 || header.readUInt32BE(20) !== 720) {
    throw new Error('precomposed_frames requires1280x720 PNG files: ' + file);
  }
  return file;
}

async function fileDigest(file) {
  const hash = crypto.createHash('sha256');
  for await (const data of fs.createReadStream(file)) hash.update(data);
  return hash.digest('hex');
}

function frameKey(story, scene, assets) {
  const {start_s, end_s, text, voice_wav, voice_delay_s, voice_duration_s, ...visual} = scene;
  return crypto.createHash('sha256').update(JSON.stringify({
    visual, assets, revision: LAYOUT_REVISION, phone_framing: !!story.phone_framing, precomposed_frames: !!story.precomposed_frames,
    captioned: !!story.captioned, burn_narration_captions: story.burn_narration_captions !== false,
    kind: story.kind,
  })).digest('hex');
}

async function renderStoryboard(options = {}) {
  const folder = options.folder || (process.env.WALKTHROUGH_DIR ? path.resolve(process.env.WALKTHROUGH_DIR) : path.join(ROOT, 'demo-output', 'cortland-double-85'));
  const story = JSON.parse(fs.readFileSync(path.join(folder, 'timed-storyboard.json')));
  const ffmpeg = options.ffmpeg || require('ffmpeg-static');
  const ffprobe = options.ffprobe || require('ffprobe-static').path;
  const render = path.join(folder, 'render');
  fs.mkdirSync(render, {recursive: true});
  const font = options.font || 'C:/Windows/Fonts/arial.ttf';
  if (fs.existsSync(font)) fs.copyFileSync(font, path.join(render, 'font.ttf'));
  const invoke = options.execute || execute;
  const run = args => invoke(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-filter_threads', '1', '-filter_complex_threads', '1', ...args], render);
  const probe = async file => JSON.parse(await invoke(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], render));
  const requestedConcurrency = Number(options.concurrency ?? process.env.WALKTHROUGH_RENDER_CONCURRENCY ?? story.render_concurrency ?? 4);
  if (!Number.isInteger(requestedConcurrency) || requestedConcurrency < 1 || requestedConcurrency > 16) throw new Error('Render concurrency must be an integer from 1 to 16');
  const indices = new Set();
  for (const scene of story.scenes) {
    if (!Number.isInteger(scene.index) || indices.has(scene.index)) throw new Error('Scene indices must be unique integers');
    indices.add(scene.index);
    if (!Number.isInteger(scene.frames) || scene.frames < 1) throw new Error('Each scene needs a positive integer frame count');
  }
  const encoded = await mapConcurrent(story.scenes, requestedConcurrency, async scene => {
    options.onSceneStart?.(scene);
    const part = path.join(render, `scene-${String(scene.index).padStart(2, '0')}.mp4`);
    const assetFiles = [...(scene.images || []).map(imageInput), scene.source_video, scene.brand_frame,
      story.burn_narration_captions !== false && scene.caption_ass].filter(Boolean);
    const assets = await Promise.all(assetFiles.map(async file => [file, await fileDigest(file)]));
    if (scene.source_video && assets.find(([file]) => file === scene.source_video)[1] !== scene.source_sha256) throw new Error('Existing source changed: ' + scene.title);
    const visualFingerprint = frameKey(story, scene, assets);
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({scene, visualFingerprint})).digest('hex');
    const cache = part + '.json';
    const pendingPart = part + '.rendering-' + process.pid + '.mp4';
    let cached;
    if (fs.existsSync(cache)) {
      try { cached = JSON.parse(fs.readFileSync(cache)); } catch { /* Interrupted caches are rerendered. */ }
    }
    if (fs.existsSync(part) && (cached?.fingerprint === fingerprint || cached?.visual_fingerprint === visualFingerprint)) {
      fs.writeFileSync(cache, JSON.stringify({...cached, fingerprint, visual_fingerprint: visualFingerprint}));
      console.log('CACHED ' + scene.title);
      options.onSceneComplete?.(scene, true);
      return part;
    }
    let input, filter, complex = false;
    if (scene.source_video) {
      input = ['-i', scene.source_video];
      filter = ((story.captioned || (story.phone_framing && story.burn_narration_captions !== false)) ? 'scale=1280:' + (story.phone_framing ? 600 : 654) + ':force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:0:color=0x0b4d3a' : 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black')
        + ',setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=' + (scene.allow_end_hold ? Math.max(1, scene.duration_s - (scene.source_duration_s || 0) + 1) : 1);
      if (scene.brand_frame) {
        input.push('-loop', '1', '-framerate', '30', '-i', scene.brand_frame);
        complex = true;
        filter = '[0:v]scale=780:480:force_original_aspect_ratio=decrease,pad=780:480:(ow-iw)/2:(oh-ih)/2:color=0x101b17,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=2[clip];[1:v]pad=1280:720:0:0:color=0x0b4d3a[background];[background][clip]overlay=454:90:shortest=1,setsar=1,fps=30';
      }
    } else {
      const images = [], label = `label-${scene.index}.txt`;
      fs.writeFileSync(path.join(render, label), scene.chapter + '\n' + scene.title);
      if (!scene.images?.length) throw new Error('Scene has no images: ' + scene.title);
      for (let i = 0; i < scene.images.length; i++) {
        if (story.precomposed_frames) {
          images.push(validatePrecomposedFrame(imageInput(scene.images[i])));
          continue;
        }
        const png = path.join(render, `frame-${scene.index}-${i}.png`);
        await run(['-i', imageInput(scene.images[i]), '-vf', imageLayout(story, scene, scene.images[i], i, label), '-frames:v', '1', png]);
        images.push(png);
      }
      if (images.length === 1) input = ['-loop', '1', '-framerate', '30', '-i', images[0]];
      else {
        const lines = [], base = Math.floor(scene.frames / images.length), extra = scene.frames % images.length;
        images.forEach((image, i) => lines.push('file ' + quoted(image), 'duration ' + ((base + (i < extra ? 1 : 0)) / 30).toFixed(9)));
        lines.push('file ' + quoted(images.at(-1)));
        const list = path.join(render, `images-${scene.index}.txt`);
        fs.writeFileSync(list, lines.join('\n'));
        input = ['-f', 'concat', '-safe', '0', '-i', list];
      }
      filter = 'setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=1';
    }
    if (scene.caption_ass && story.burn_narration_captions !== false) {
      const caption = 'captions-' + scene.index + '.ass';
      fs.copyFileSync(scene.caption_ass, path.join(render, caption));
      filter += ',ass=filename=' + caption;
    }
    if (story.kind === 'overview') filter += (scene.index ? ',fade=t=in:st=0:d=0.16:color=0xf1f6f2' : '') + `,fade=t=out:st=${Math.max(0, scene.duration_s - .16)}:d=0.16:color=0xf1f6f2`;
    const filters = complex ? ['-filter_complex', filter + '[v]', '-map', '[v]'] : ['-vf', filter];
    await run([...input, '-an', ...filters, '-frames:v', scene.frames, '-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-profile:v', 'high', '-level:v', '4.1', '-pix_fmt', 'yuv420p', '-threads', '2', '-video_track_timescale', '15360', pendingPart]);
    const info = await probe(pendingPart), video = info.streams.find(stream => stream.codec_type === 'video');
    if (Number(video.nb_frames) !== scene.frames) throw new Error('Scene frame count mismatch: ' + scene.title);
    fs.renameSync(pendingPart, part);
    fs.writeFileSync(cache, JSON.stringify({fingerprint, visual_fingerprint: visualFingerprint, revision: LAYOUT_REVISION, phone_framing: !!story.phone_framing, frames: scene.frames, duration_s: Number(info.format.duration)}));
    console.log('RENDERED ' + (scene.index + 1) + '/' + story.scenes.length + ' ' + scene.title);
    options.onSceneComplete?.(scene, false);
    return part;
  });
  const list = path.join(render, 'parts.txt');
  fs.writeFileSync(list, encoded.map(file => 'file ' + quoted(file)).join('\n'));
  const chapters = [];
  for (const scene of story.scenes) {
    const chapter = chapters.at(-1);
    if (!chapter || chapter.title !== scene.chapter) chapters.push({title: scene.chapter, start: scene.start_s, end: scene.end_s});
    else chapter.end = scene.end_s;
  }
  const meta = path.join(render, 'chapters.ffmeta');
  fs.writeFileSync(meta, ';FFMETADATA1\n' + chapters.map(chapter => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(chapter.start * 1000)}\nEND=${Math.round(chapter.end * 1000)}\ntitle=${chapter.title}\n`).join(''));
  const output = options.outputDir || path.join(ROOT, 'output', 'video');
  fs.mkdirSync(output, {recursive: true});
  const basename = story.output_basename || 'Cortland-Double-Complete-Walkthrough';
  const final = path.join(output, basename + '.mp4');
  await run(['-f', 'concat', '-safe', '0', '-i', list, '-i', story.video_soundtrack_wav, '-f', 'ffmetadata', '-i', meta, '-map', '0:v:0', '-map', '1:a:0', '-map_metadata', '2', '-map_chapters', '2', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', story.duration_s, '-movflags', '+faststart', '-metadata', 'title=' + (story.title || 'GameFrame — Guided Walkthrough'), final]);
  const sidecar = path.join(output, basename + '.srt');
  const burnedCaptions = story.burn_narration_captions !== false && story.scenes.some(scene => scene.caption_ass);
  if (!burnedCaptions) fs.copyFileSync(path.join(folder, 'voiceover.srt'), sidecar);
  else if (fs.existsSync(sidecar)) {
    const archive = path.join(folder, 'player-subtitle-archive');
    fs.mkdirSync(archive, {recursive: true});
    fs.renameSync(sidecar, path.join(archive, basename + '-' + Date.now() + '.srt'));
  }
  const info = await probe(final);
  if (Math.abs(Number(info.format.duration) - story.duration_s) > .12) throw new Error('Final soundtrack/video duration mismatch');
  const report = {video: final, duration_s: Number(info.format.duration), voiceover: story.voiceover_mp3, phone_framing: !!story.phone_framing, render_concurrency: requestedConcurrency, layout_revision: LAYOUT_REVISION, chapters, scenes: story.scenes.map(scene => ({title: scene.title, start: scene.start_s, end: scene.end_s, source_video: scene.source_video, source_sha256: scene.source_sha256})), probe: info};
  fs.writeFileSync(path.join(folder, 'render-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({video: final, duration_s: Number(info.format.duration), chapters}));
  return report;
}

module.exports = {renderStoryboard, mapConcurrent, imageCrop, imageLayout, frameKey, validatePrecomposedFrame, LAYOUT_REVISION};
if (require.main === module) renderStoryboard().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
