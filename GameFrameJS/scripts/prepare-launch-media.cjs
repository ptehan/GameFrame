const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'release-artifacts/launch/media');
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(path.join(out, 'caption-sources'), { recursive: true });
const clips = [
  { name: '01-why-matchups', source: 'GameFrame-Why-Matchups-Matter-Caption-Safe', seconds: 25 },
  { name: '02-four-workflows', source: 'GameFrame-Four-Workflows-Caption-Safe', seconds: 25 },
  { name: '03-ev-to-matchup', source: 'GameFrame-EV-to-Matchup-Walkthrough-Four-Points-Caption-Safe', seconds: 35 },
  { name: '04-why-gameframe', source: 'GameFrame-Why-GameFrame-Refined-Caption-Safe', seconds: 30 },
];
const clock = seconds => {
  const ms = Math.round(seconds * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
const seconds = time => { const [h, m, rest] = time.split(':'); return Number(h) * 3600 + Number(m) * 60 + Number(rest.replace(',', '.')); };
for (const clip of clips) {
  const source = path.join(root, 'output/video', clip.source + '.mp4'), target = path.join(out, clip.name + '.mp4');
  if (!fs.existsSync(source)) throw new Error(`Missing source video: ${clip.source}`);
  const subtitle = path.join(root, 'output/video', clip.source + '.srt');
  if (fs.existsSync(subtitle)) {
    const cues = [...fs.readFileSync(subtitle, 'utf8').replaceAll('\r', '').matchAll(/(\d\d:\d\d:\d\d,\d{3}) --> (\d\d:\d\d:\d\d,\d{3})\n([^]*?)(?=\n\s*\n|$)/g)]
      .map(match => ({ start: seconds(match[1]), end: seconds(match[2]), text: match[3].trim() }));
    const endings = cues.filter(cue => /[.!?]["')]*$/.test(cue.text) && cue.end >= clip.seconds - 12 && cue.end <= clip.seconds + 7)
      .sort((a, b) => Math.abs(a.end - clip.seconds) - Math.abs(b.end - clip.seconds));
    if (endings.length) {
      const end = endings[0].end, next = cues.find(cue => cue.start >= end);
      clip.seconds = Number((end + Math.min(0.15, Math.max(0, (next?.start || end) - end) / 2)).toFixed(3));
    }
  }
  const result = spawnSync(require('ffmpeg-static'), ['-y', '-v', 'error', '-i', source, '-t', String(clip.seconds),
    '-vf', 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=0x14231c,setsar=1',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '21', '-threads', '2', '-c:a', 'aac', '-movflags', '+faststart', target], { windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'Excerpt encoding failed');
  if (fs.existsSync(subtitle)) {
    const cues = [];
    for (const block of fs.readFileSync(subtitle, 'utf8').replaceAll('\r', '').split(/\n\s*\n/)) {
      const match = /(?:^|\n)(\d\d:\d\d:\d\d,\d{3}) --> (\d\d:\d\d:\d\d,\d{3})\n([\s\S]*)/.exec(block);
      if (match && seconds(match[1]) < clip.seconds) cues.push(`${cues.length + 1}\n${match[1]} --> ${clock(Math.min(seconds(match[2]), clip.seconds))}\n${match[3].trim()}`);
    }
    fs.writeFileSync(path.join(out, 'caption-sources', clip.name + '.srt'), cues.join('\n\n') + '\n');
    const captioned = path.join(out, clip.name + '.captioned.mp4');
    const relativeCaptions = path.relative(root, path.join(out, 'caption-sources', clip.name + '.srt')).split(path.sep).join('/');
    const captionRun = spawnSync(require('ffmpeg-static'), ['-y', '-v', 'error', '-i', target,
      '-vf', `subtitles=${relativeCaptions}:force_style='Fontname=Arial,Fontsize=10,PrimaryColour=&H00FFFFFF,OutlineColour=&H0014231C,BorderStyle=1,Outline=1.2,Shadow=0,MarginV=34,MarginL=18,MarginR=18,Alignment=2'`,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '21', '-threads', '2', '-c:a', 'copy', '-movflags', '+faststart', captioned],
      { cwd: root, windowsHide: true, encoding: 'utf8' });
    if (captionRun.status !== 0) throw new Error(captionRun.stderr || 'Caption rendering failed');
    fs.renameSync(captioned, target);
  }
  const verification = spawnSync(require('ffmpeg-static'), ['-v', 'error', '-i', target, '-f', 'null', '-'], { windowsHide: true, encoding: 'utf8' });
  if (verification.status !== 0) throw new Error('Excerpt decode verification failed');
  clip.bytes = fs.statSync(target).size; clip.review = 'Private draft: review narration cut, overlays, names and footage permission before publication';
}
const logo = path.join(root, 'ev-predictor/assets/gameframe-logo-video.png');
const image = fs.existsSync(logo) ? `<image href="data:image/png;base64,${fs.readFileSync(logo).toString('base64')}" x="64" y="42" width="280" height="125" preserveAspectRatio="xMinYMid meet"/>` : '<text x="64" y="125" font-family="Arial" font-size="60" fill="#f7f5e9">GameFrame</text>';
for (const [name, first, second, small] of [
  ['introduction', 'See your swing', 'against the pitch.', 'GameFrame introduction'],
  ['walkthrough', 'Build your', 'first matchup.', 'Upload · Tag · Compare'],
  ['matching', 'Why this', 'EV match?', 'Read the evidence. Compare alternatives.'],
]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#14231c"/>${image}<rect x="64" y="198" width="110" height="8" fill="#c8d77a"/><text x="64" y="305" font-family="Arial" font-weight="700" font-size="68" fill="#f7f5e9">${first}</text><text x="64" y="390" font-family="Arial" font-weight="700" font-size="68" fill="#f7f5e9">${second}</text><text x="64" y="486" font-family="Arial" font-size="27" fill="#c8d77a">${small}</text><g transform="translate(855,220)"><rect width="350" height="300" rx="22" fill="#21392d"/><text x="30" y="62" font-family="Arial" font-size="25" fill="#f7f5e9">Pitch</text><text x="30" y="162" font-family="Arial" font-size="25" fill="#f7f5e9">Swing</text><path d="M30 100H310M30 200H310" stroke="#7a9781" stroke-width="7"/><path d="M270 83v138" stroke="#c8d77a" stroke-width="5"/><circle cx="115" cy="100" r="12" fill="#f7f5e9"/><circle cx="180" cy="200" r="12" fill="#f7f5e9"/><text x="210" y="266" font-family="Arial" font-size="23" fill="#c8d77a">Contact</text></g><text x="64" y="650" font-family="Arial" font-size="25" fill="#b8c4b8">BASEBALL VIDEO STUDY</text></svg>`;
  fs.writeFileSync(path.join(out, `thumbnail-${name}.svg`), svg);
}
fs.writeFileSync(path.join(out, 'media-manifest.json'), JSON.stringify({ status: 'private drafts; not cleared for publication', clips,
  full_video_candidates: ['GameFrame-Why-GameFrame-Refined-Caption-Safe.mp4', 'GameFrame-Four-Workflows-Caption-Safe.mp4', 'GameFrame-Technical-Overview-Refined.mp4'],
  note: 'Captions are burned into the portrait drafts. Caption source files are separate so players do not overlay them twice. Review footage permissions before upload.' }, null, 2));
console.log('Prepared and decoded four portrait excerpts, clipped captions and three thumbnail SVG drafts.');
