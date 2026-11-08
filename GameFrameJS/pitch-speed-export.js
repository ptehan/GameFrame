const fs = require('fs');
const path = require('path');

// Uses the EV export's logo, dark teal treatment, mint metrics, and closing audit card.
function buildPitchSpeedExport({dir,blob,speed,name,description,logo,font,run}) {
  fs.writeFileSync(path.join(dir,'source.mp4'),blob);
  let textId = 0;
  const escape = value => value.replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"\\'");
  const fontOption = font ? `fontfile='${escape(font)}':` : '';
  function text(value,size,y,color='0xf8fcfa',x='(w-text_w)/2') {
    const filename = `text-${textId++}.txt`;
    fs.writeFileSync(path.join(dir,filename),String(value));
    return `drawtext=${fontOption}textfile=${filename}:expansion=none:fontsize=${size}:fontcolor=${color}:x=${x}:y=${y}`;
  }
  const mph = `${speed.mph.toFixed(1)} mph`, average = `${speed.average.toFixed(1)} mph average`;
  const base = 'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1';
  function card(filename,seconds,frame,draws) {
    const graph = `[0:v]select=eq(n\\,${frame}),${base},gblur=sigma=10,drawbox=x=0:y=0:w=iw:h=ih:color=0x04090b@0.75:t=fill,loop=loop=-1:size=1:start=0,setpts=N/(30*TB)[bg];` +
      `[1:v]scale=300:-1,format=rgba[logo];[bg][logo]overlay=x=(W-w)/2:y=30,${draws.join(',')},format=yuv420p[out]`;
    run('ffmpeg',['-y','-filter_complex_threads','1','-i','source.mp4','-i',logo,'-filter_complex',graph,'-map','[out]','-t',String(seconds),'-r','30','-an','-c:v','libx264','-preset','veryfast','-crf','22','-threads','1',filename],{cwd:dir});
  }
  card('title.mp4',3,0,[text(String(name || 'Pitcher').slice(0,48),40,180),text(String(description || 'Pitch Speed').slice(0,64),26,240,'0xd2e0df'),text('OUT OF THE HAND',28,335,'0xb2dbd4'),text(mph,82,385),text(average,30,505,'0xb2dbd4'),text('Video-based estimate',22,620)]);
  function replay(filename,rate) {
    const graph = `[0:v]trim=end_frame=${speed.contact+1},setpts=(PTS-STARTPTS)/${rate},split[bg][fg];[bg]${base},gblur=sigma=20[back];` +
      `[fg]scale=1280:720:force_original_aspect_ratio=decrease[front];[back][front]overlay=(W-w)/2:(H-h)/2,` +
      `drawbox=x=0:y=0:w=iw:h=98:color=0x081215@0.88:t=fill,${text(`${mph} out of the hand | ${average}`,32,20)},${text(rate===1?'Normal speed':'Half speed',20,63,'0xb2dbd4')},fps=30,format=yuv420p[out]`;
    run('ffmpeg',['-y','-filter_complex_threads','1','-i','source.mp4','-filter_complex',graph,'-map','[out]','-an','-c:v','libx264','-preset','veryfast','-crf','22','-threads','1',filename],{cwd:dir});
  }
  replay('normal.mp4',1);
  replay('slow.mp4',0.5);
  card('closing.mp4',8,speed.contact,[
    text(`${mph} OUT OF THE HAND | ${average}`,36,165,'0xb2dbd4'),
    text('TIMING AND DISTANCE',26,245),
    text(`Release frame ${speed.release} | Contact frame ${speed.contact} | ${speed.fps} FPS`,25,300),
    text(`${speed.frames} frames / ${speed.fps} FPS = ${speed.seconds.toFixed(4)} seconds`,25,345),
    text(`Mound ${speed.mound} ft - extension ${speed.extension} ft - contact adjustment ${speed.contactDistance} ft`,25,390),
    text(`3600 x ${Number(speed.distance.toFixed(4))} x ${speed.fps} / ${speed.frames} / 5280 = ${speed.average.toFixed(1)} mph average`,25,435),
    text(`Out of the hand = average x 1.05 (assumed 5% correction)`,25,480),
    text('User-selected release; estimated distances. Not a radar measurement.',22,555,'0xb2dbd4'),
    text('Frames are zero-based. Mound distance is rubber to plate back point.',20,600),
    text('Contact adjustment is measured forward from the plate back point.',20,635)
  ]);
  fs.writeFileSync(path.join(dir,'concat.txt'),['title','normal','slow','closing'].map(name=>`file '${name}.mp4'`).join('\n'));
  run('ffmpeg',['-y','-f','concat','-safe','0','-i','concat.txt','-c','copy','-movflags','+faststart','pitch-speed.mp4'],{cwd:dir});
  return fs.readFileSync(path.join(dir,'pitch-speed.mp4'));
}

module.exports = {buildPitchSpeedExport};
