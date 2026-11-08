/* Matchup media processing has no database or application-server side effects. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const ROOT=__dirname,TMP_DIR=os.tmpdir();
function parseFraction(raw) {
  if (!raw) return 0;
  if (typeof raw === "number") return raw;
  const s = String(raw).trim();
  if (!s) return 0;
  if (s.includes("/")) {
    const [n, d] = s.split("/").map(Number);
    if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return 0;
    return n / d;
  }
  const x = Number(s);
  return Number.isFinite(x) ? x : 0;
}

function runCmd(cmd, args, options = {}) {
  const executable = cmd === "ffmpeg"
    ? (process.env.FFMPEG_PATH || cmd)
    : cmd === "ffprobe"
      ? (process.env.FFPROBE_PATH || cmd)
      : cmd;
  const result = spawnSync(executable, args, {
    encoding: null,
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true,
    timeout: 180000,
    ...options,
  });
  if (result.error) {
    throw new Error(`${cmd} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const err = (result.stderr || Buffer.from("")).toString("utf8");
    throw new Error(`${cmd} failed (${result.status}): ${err}`);
  }
  return result;
}

function ffprobeMeta(filePath, countFrames = false) {
  try {
    const r = runCmd("ffprobe", [
      "-v", "error",
      ...(countFrames ? ["-count_frames"] : []),
      "-select_streams", "v:0",
      "-show_entries", "stream=nb_read_frames,nb_frames,avg_frame_rate,r_frame_rate,duration:stream_tags=creation_time",
      "-show_entries", "format=duration:format_tags=creation_time",
      "-of", "json",
      filePath,
    ]);
    const j = JSON.parse((r.stdout || Buffer.from("")).toString("utf8") || "{}");
    const stream = (j.streams && j.streams[0]) || {};
    const fmt = j.format || {};
    const fps = parseFraction(stream.avg_frame_rate) || parseFraction(stream.r_frame_rate);
    let frameCount = Number(stream.nb_read_frames || stream.nb_frames || 0);
    // Tagged MP4s carry exact container counts. Decode only when those are absent.
    if ((!Number.isFinite(frameCount) || frameCount <= 0) && !countFrames) return ffprobeMeta(filePath, true);
    const duration = Number(stream.duration || fmt.duration || 0);
    const creationTime = normalizedVideoDate(
      (stream.tags && stream.tags.creation_time) || (fmt.tags && fmt.tags.creation_time)
    );
    if ((!Number.isFinite(frameCount) || frameCount <= 0) && fps > 0 && duration > 0) {
      frameCount = Math.round(fps * duration);
    }
    return {
      fps: Number.isFinite(fps) && fps > 0 ? fps : 0,
      frameCount: Number.isFinite(frameCount) && frameCount > 0 ? frameCount : 0,
      duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
      creationTime,
    };
  } catch (_) {
    return { fps: 0, frameCount: 0, duration: 0, creationTime: null };
  }
}

function extractLastFrameJpeg(filePath) {
  try {
    const r = runCmd("ffmpeg", [
      "-v", "error",
      "-sseof", "-0.05",
      "-i", filePath,
      "-frames:v", "1",
      "-f", "image2pipe",
      "-vcodec", "mjpeg",
      "pipe:1",
    ]);
    return r.stdout && r.stdout.length > 0 ? r.stdout : null;
  } catch (_) {
    return null;
  }
}

function ffmpegDrawtextEscape(text) {
  return String(text == null ? "" : text)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/,/g, "\\,");
}

function wrapTitleLines(text, maxChars = 34, maxLines = 3) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.length ? lines : ["Matchup Summary"];
}

function matchupFontFile() {
  const custom = process.env.GAMEFRAME_FONT_FILE;
  if (custom && fs.existsSync(custom)) return custom;
  const win = process.env.WINDIR || "C:\\Windows";
  const arial = path.join(win, "Fonts", "arial.ttf");
  return fs.existsSync(arial) ? arial : "";
}

function normalizedVideoDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function buildMatchupVideoServerSide({ pitchBlob, swingBlob, description, hitterName, pitcherName, swingLabel, swingSeconds, decisionFrame, swingContactFrame, pitchContactFrame, pitchSpeed, swingEv }) {
  const jobId = `gf_matchup_${crypto.randomUUID()}`;
  const dir = path.join(TMP_DIR, jobId);
  fs.mkdirSync(dir, { recursive: true });
  const pitchPath = path.join(dir, "pitch.mp4");
  const swingPath = path.join(dir, "swing.mp4");
  const titlePath = path.join(dir, "title.mp4");
  const bodyPath = path.join(dir, "body.mp4");
  const outputPath = path.join(dir, "matchup.mp4");
  const collagePath = path.join(dir, "collage.jpg");
  const fontfile = matchupFontFile().replace(/\\/g, "/");
  const logoPath = fs.existsSync(path.join(ROOT, "static", "logo", "gameframe-logo-video.png"))
    ? path.join(ROOT, "static", "logo", "gameframe-logo-video.png")
    : path.join(ROOT, "ev-predictor", "assets", "gameframe-logo-video.png");
  const segmentPaths = [];

  try {
    fs.writeFileSync(pitchPath, pitchBlob);
    fs.writeFileSync(swingPath, swingBlob);

    const pitchMeta = ffprobeMeta(pitchPath);
    const swingMeta = ffprobeMeta(swingPath);
    const pitchFps = Number(pitchMeta.fps) || 30;
    const swingFps = Number(swingMeta.fps) || 30;
    const commonFps = 60;
    const pitchFrameCount = Number(pitchMeta.frameCount || 0);
    const swingFrameCount = Number(swingMeta.frameCount || 0);
    if (!pitchFrameCount || !swingFrameCount) {
      throw new Error("Unable to read matchup clip timing.");
    }

    const rawPitchContactFrame = Number(pitchContactFrame);
    const resolvedPitchContactFrame = Number.isFinite(rawPitchContactFrame)
      ? Math.max(0, Math.min(pitchFrameCount - 1, Math.round(rawPitchContactFrame)))
      : Math.max(0, pitchFrameCount - 1);
    const visualSwingLastIdx = Math.max(0, swingFrameCount - 1);
    const swingContactIdx = Number.isFinite(Number(swingContactFrame))
      ? Math.max(0, Math.min(visualSwingLastIdx, Math.round(Number(swingContactFrame))))
      : visualSwingLastIdx;
    const pitchContactOutput = Math.round((resolvedPitchContactFrame / pitchFps) * commonFps);
    const swingContactOutput = Math.round((swingContactIdx / swingFps) * commonFps);
    // The swing clip begins on its first-move frame. Repeat that exact frame for
    // the difference between the pitch and swing timelines so both clips finish
    // at contact together.
    const padCount = Math.max(0, pitchContactOutput - swingContactOutput);
    const rawDecisionFrame = Number(decisionFrame);
    const decisionSource = Number.isFinite(rawDecisionFrame)
      ? Math.max(0, Math.min(swingContactIdx, Math.round(rawDecisionFrame)))
      : Math.max(0, swingContactIdx - 5);
    const decisionLocal = Math.round((decisionSource / swingFps) * commonFps);
    let decisionGlobal = decisionLocal + padCount;
    const contactGlobal = pitchContactOutput;
    if (decisionGlobal >= contactGlobal) {
      decisionGlobal = Math.max(padCount, contactGlobal - 1);
    }

    const FREEZE_FRAMES = 2 * commonFps;
    const TITLE_SECONDS = 4;
    const OUTPUT_W = 1280;
    const OUTPUT_H = 720;
    const HALF_W = 640;
    const labelBoxW = 420;
    const labelBoxH = 72;
    const safeDesc = ffmpegDrawtextEscape(description || "Matchup");
    const safeTitle = ffmpegDrawtextEscape(`${hitterName} vs ${pitcherName}`);
    const safeSwingLabel = ffmpegDrawtextEscape(String(swingLabel || "Selected swing").slice(0, 90));
    const swingDurationText = `${Number.isFinite(Number(swingSeconds)) ? Number(swingSeconds).toFixed(2) : "0.00"}s`;
    const decisionToContactSeconds = swingFps > 0 && Number.isFinite(Number(decisionSource)) && Number.isFinite(Number(swingContactIdx))
      ? Math.max(0, (Number(swingContactIdx) - Number(decisionSource)) / swingFps)
      : null;
    const decisionToContactText = Number.isFinite(decisionToContactSeconds)
      ? `${decisionToContactSeconds.toFixed(2)}s`
      : "--";
    const safeDate = ffmpegDrawtextEscape(new Date().toLocaleDateString("en-US"));
    const labelX = `(w-${labelBoxW})/2`;
    const velocityFooterHeight = pitchSpeed || swingEv ? 78 : 0;
    const labelY = `h-${labelBoxH + 22 + velocityFooterHeight}`;

    const drawtextBase = fontfile ? `fontfile='${ffmpegDrawtextEscape(fontfile)}':` : "";

    function framesToCloneSeconds(frameCount) {
      return Math.max(0, (Number(frameCount || 0) - 1) / commonFps);
    }

    function sideChain(inputIndex, sourceFrameCount, startFrame, endFrameExclusive, outputFrames, tint = null, outLabel = "tmp", blackout = false, holdFrame = false) {
      const desiredFrames = Math.max(1, Math.round(outputFrames));
      const clampedStart = Math.max(0, Math.min(sourceFrameCount - 1, startFrame));
      const clampedEndExclusive = Math.max(
        clampedStart + 1,
        Math.min(sourceFrameCount, Math.max(startFrame + 1, endFrameExclusive))
      );
      let chain = `[${inputIndex}:v]trim=start_frame=${clampedStart}:end_frame=${clampedEndExclusive},setpts=PTS-STARTPTS`;
      if (holdFrame) chain += ',trim=end_frame=1';
      if (tint) {
        chain += `,drawbox=x=0:y=0:w=iw:h=ih:color=${tint}@0.25:t=fill`;
      }
      const footerHeight = pitchSpeed || swingEv ? 78 : 0;
      const imageHeight = OUTPUT_H - footerHeight;
      chain += `,scale=${HALF_W}:${imageHeight}:force_original_aspect_ratio=decrease,pad=${HALF_W}:${imageHeight}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`;
      if (blackout) {
        chain += `,drawbox=x=0:y=0:w=iw:h=ih:color=black@1:t=fill`;
      }
      if (footerHeight) {
        const speed = inputIndex === 0 ? pitchSpeed?.mph : swingEv;
        const caption = inputIndex === 0 ? 'Pitch speed' : 'Exit velocity';
        chain += `,pad=${HALF_W}:${OUTPUT_H}:0:0:color=0x10191b`;
        if (Number.isFinite(Number(speed)) && Number(speed) > 0) {
          chain += `,drawtext=${drawtextBase}text='${caption} ${Number(speed).toFixed(1)} mph':fontcolor=0xf7faf9:fontsize=28:x=(w-text_w)/2:y=${imageHeight + 24}`;
        }
      }
      // Size and annotate original frames once, then repeat the finished image.
      // Loop before fps so a lone high-FPS source frame cannot be discarded.
      if (holdFrame) {
        chain += `,loop=loop=-1:size=1:start=0,setpts=N/(${commonFps}*TB),fps=${commonFps},trim=end_frame=${desiredFrames},setpts=PTS-STARTPTS`;
      } else {
        chain += `,tpad=stop_mode=clone:stop_duration=${framesToCloneSeconds(desiredFrames + 1)},fps=${commonFps},trim=end_frame=${desiredFrames},setpts=PTS-STARTPTS`;
      }
      return `${chain}[${outLabel}]`;
    }

    function pushSegment(filters, segments, key, pitchSpec, swingSpec, labelText = "") {
      const left = `${key}_l`;
      const right = `${key}_r`;
      const stacked = `${key}_s`;
      const out = `${key}_o`;
      filters.push(sideChain(0, pitchFrameCount, pitchSpec.start, pitchSpec.end, pitchSpec.outputFrames, pitchSpec.tint || null, left, pitchSpec.blackout || false, !!pitchSpec.holdFrame));
      filters.push(sideChain(1, swingFrameCount, swingSpec.start, swingSpec.end, swingSpec.outputFrames, swingSpec.tint || null, right, swingSpec.blackout || false, !!swingSpec.holdFrame));
      filters.push(`[${left}][${right}]hstack=inputs=2[${stacked}]`);
      if (labelText) {
        const safeLabel = ffmpegDrawtextEscape(labelText);
        filters.push(
          `[${stacked}]drawbox=x=${labelX}:y=${labelY}:w=${labelBoxW}:h=${labelBoxH}:color=black@0.72:t=fill,` +
          `drawtext=${drawtextBase}text='${safeLabel}':fontcolor=white:fontsize=34:x=(w-text_w)/2:y=h-${labelBoxH - 20 + velocityFooterHeight},` +
          `format=yuv420p[${out}]`
        );
      } else {
        filters.push(`[${stacked}]format=yuv420p[${out}]`);
      }
      segments.push(`[${out}]`);
    }

    function pitchSpecForGlobalRange(globalStart, globalEndExclusive, opts = {}) {
      const outputFrames = opts.freezeFrames || Math.max(1, globalEndExclusive - globalStart);
      const eventFrame = Math.round((globalStart / commonFps) * pitchFps);
      return {
        start: Math.min(eventFrame, pitchFrameCount - 1),
        end: opts.freezeFrames
          ? Math.min(eventFrame + 1, pitchFrameCount)
          : Math.min(Math.max(eventFrame + 1, Math.ceil((globalEndExclusive / commonFps) * pitchFps)), pitchFrameCount),
        outputFrames,
        tint: opts.tint || null,
        holdFrame: !!opts.freezeFrames,
      };
    }

    function swingSpecForGlobalRange(globalStart, globalEndExclusive, opts = {}) {
      if (globalEndExclusive <= padCount) {
        return {
          start: 0,
          end: 1,
          outputFrames: opts.freezeFrames || Math.max(1, globalEndExclusive - globalStart),
          tint: opts.tint || null,
          blackout: !!opts.swingBlackout,
          holdFrame: true,
        };
      }
      const localStartOutput = Math.max(0, globalStart - padCount);
      const localEndOutput = Math.max(localStartOutput + 1, globalEndExclusive - padCount);
      const localStart = Math.max(0, Math.min(visualSwingLastIdx, Math.round((localStartOutput / commonFps) * swingFps)));
      const localEndExclusive = opts.freezeFrames
        ? Math.min(localStart + 1, swingFrameCount)
        : Math.max(localStart + 1, Math.min(swingFrameCount, Math.ceil((localEndOutput / commonFps) * swingFps)));
      return {
        start: localStart,
        end: localEndExclusive,
        outputFrames: opts.freezeFrames || Math.max(1, globalEndExclusive - globalStart),
        tint: opts.tint || null,
        blackout: !!opts.swingBlackout,
        holdFrame: !!opts.freezeFrames,
      };
    }

    function pushGlobalSegment(filters, segments, key, globalStart, globalEndExclusive, opts = {}) {
      if (globalEndExclusive <= globalStart) return;
      pushSegment(
        filters,
        segments,
        key,
        pitchSpecForGlobalRange(globalStart, globalEndExclusive, opts),
        swingSpecForGlobalRange(globalStart, globalEndExclusive, opts),
        opts.labelText || ""
      );
    }

    function titleCardFilter(inputLabel, logoLabel, outLabel, cardLabel) {
      const text = [];
      for (const [center, name, label, speed] of [
        [320, pitcherName || 'Pitcher', 'Pitch speed', pitchSpeed?.mph],
        [960, hitterName || 'Hitter', 'Exit velocity', swingEv],
      ]) {
        wrapTitleLines(name, 25, 2).forEach((line, index) => {
          text.push(`drawtext=${drawtextBase}text='${ffmpegDrawtextEscape(line)}':fontcolor=0xf8fcfa:fontsize=34:x=${center}-text_w/2:y=${280 + index * 42}`);
        });
        if (Number.isFinite(Number(speed)) && Number(speed) > 0) {
          text.push(`drawtext=${drawtextBase}text='${label} ${Number(speed).toFixed(1)} mph':fontcolor=0xf8fcfa:fontsize=32:x=${center}-text_w/2:y=398`);
        }
      }
      text.push(`drawtext=${drawtextBase}text='Swing ${swingDurationText}   |   Decision ${decisionToContactText}':fontcolor=0xbac9ca:fontsize=26:x=(w-text_w)/2:y=540`);
      return (
        `[${inputLabel}]gblur=sigma=10,drawbox=x=0:y=0:w=iw:h=ih:color=0x04090b@0.62:t=fill,` +
        `loop=loop=-1:size=1:start=0,setpts=N/(${commonFps}*TB),fps=${commonFps},trim=end_frame=${TITLE_SECONDS * commonFps},setpts=PTS-STARTPTS[${outLabel}_bg];` +
        `[${outLabel}_bg][${logoLabel}]overlay=x=(W-w)/2:y=76,` +
        `${text.join(',')},format=yuv420p[${outLabel}]`
      );
    }

    const titleFilters = [
      `[0:v]trim=start_frame=0:end_frame=1,setpts=PTS-STARTPTS,scale=${HALF_W}:${OUTPUT_H}:force_original_aspect_ratio=decrease,pad=${HALF_W}:${OUTPUT_H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[title_pitch]`,
      `[1:v]trim=start_frame=0:end_frame=1,setpts=PTS-STARTPTS,scale=${HALF_W}:${OUTPUT_H}:force_original_aspect_ratio=decrease,pad=${HALF_W}:${OUTPUT_H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[title_swing]`,
      `[title_pitch][title_swing]hstack=inputs=2[title_src]`,
      `[2:v]scale=420:-1,format=rgba[logo_title]`,
      titleCardFilter("title_src", "logo_title", "title_out", "MATCHUP")
    ];
    runCmd("ffmpeg", [
      "-y",
      "-i", pitchPath,
      "-i", swingPath,
      "-i", logoPath,
      "-filter_complex_threads", "1",
      "-filter_complex", titleFilters.join(";"),
      "-map", "[title_out]",
      "-r", String(commonFps),
      "-threads", String(Math.max(1, Math.min(2, Number(process.env.MATCHUP_ENCODER_THREADS) || os.cpus().length))),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      titlePath,
    ], { cwd: dir });

    const filters = [];
    const segments = [];

    if (padCount > 0) {
      // Hold the swing's first-move frame while the pitch catches up. The next
      // segment still applies the yellow Start pause before swing motion begins.
      pushGlobalSegment(filters, segments, "seg_lead", 0, padCount);
    }

    pushGlobalSegment(filters, segments, "seg_first", padCount, padCount + 1, {
      freezeFrames: FREEZE_FRAMES,
      tint: "yellow",
      labelText: "Start",
    });

    if (decisionGlobal > padCount + 1) {
      pushGlobalSegment(filters, segments, "seg_motion_a", padCount + 1, decisionGlobal);
    }

    pushGlobalSegment(filters, segments, "seg_decision", decisionGlobal, decisionGlobal + 1, {
      freezeFrames: FREEZE_FRAMES,
      tint: "green",
      labelText: "Decision",
    });

    if (contactGlobal > decisionGlobal + 1) {
      pushGlobalSegment(filters, segments, "seg_motion_b", decisionGlobal + 1, contactGlobal + 1);
    }

    pushGlobalSegment(filters, segments, "seg_contact", contactGlobal, contactGlobal + 1, {
      freezeFrames: FREEZE_FRAMES,
      labelText: "Contact",
    });

    filters.push(`${segments.join("")}concat=n=${segments.length}:v=1:a=0[outv]`);

    runCmd("ffmpeg", [
      "-y",
      "-i", pitchPath,
      "-i", swingPath,
      "-filter_complex_threads", "1",
      "-filter_complex", filters.join(";"),
      "-map", "[outv]",
      "-r", String(commonFps),
      "-threads", String(Math.max(1, Math.min(2, Number(process.env.MATCHUP_ENCODER_THREADS) || os.cpus().length))),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      bodyPath,
    ], { cwd: dir });

    const concatPath = path.join(dir, "concat.txt");
    for (const [name, file] of [["title", titlePath], ["body", bodyPath]]) {
      if (ffprobeMeta(file).frameCount < 1) {
        throw new Error(`Matchup ${name} segment contains no video frames. The source clips were not changed.`);
      }
    }
    const concatFile = (p) => `file '${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;
    fs.writeFileSync(concatPath, [concatFile(titlePath), concatFile(bodyPath), concatFile(titlePath)].join("\n"));
    runCmd("ffmpeg", [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", concatPath,
      "-c", "copy",
      "-movflags", "+faststart",
      outputPath,
    ], { cwd: dir });

    // Show what the pitcher looks like when the hitter must start and decide.
    const collagePanelW = 640;
    const collageH = 720;
    const collageLabelH = 64;
    const collageImageH = collageH - collageLabelH;
    const pitchInsetW = 180;
    const pitchInsetH = 320;
    const pitchStartFrame = Math.max(0, Math.min(pitchFrameCount - 1, Math.round((padCount / commonFps) * pitchFps)));
    const pitchDecisionFrame = Math.max(0, Math.min(pitchFrameCount - 1, Math.round((decisionGlobal / commonFps) * pitchFps)));
    const collageEvents = [
      { key: "start", label: "START FRAME", pitchFrame: pitchStartFrame, swingFrame: 0, color: "yellow" },
      { key: "decision", label: "DECISION FRAME", pitchFrame: pitchDecisionFrame, swingFrame: decisionSource, color: "green" },
    ];
    const collageFilters = [
      `[0:v]split=2${collageEvents.map((event) => `[p_${event.key}]`).join("")}`,
      `[1:v]split=2${collageEvents.map((event) => `[s_${event.key}]`).join("")}`,
    ];
    for (const event of collageEvents) {
      collageFilters.push(
        `[p_${event.key}]trim=start_frame=${event.pitchFrame}:end_frame=${event.pitchFrame + 1},setpts=PTS-STARTPTS,` +
        `scale=${pitchInsetW}:${pitchInsetH}:force_original_aspect_ratio=decrease,` +
        `pad=${pitchInsetW}:${pitchInsetH}:(ow-iw)/2:(oh-ih)/2:black,` +
        `pad=${pitchInsetW + 8}:${pitchInsetH + 8}:4:4:white[p_${event.key}_still]`
      );
      collageFilters.push(
        `[s_${event.key}]trim=start_frame=${event.swingFrame}:end_frame=${event.swingFrame + 1},setpts=PTS-STARTPTS,` +
        `scale=${collagePanelW}:${collageImageH}:force_original_aspect_ratio=decrease,` +
        `pad=${collagePanelW}:${collageImageH}:(ow-iw)/2:(oh-ih)/2:black[s_${event.key}_still]`
      );
      collageFilters.push(
        `[s_${event.key}_still][p_${event.key}_still]overlay=x=W-w-16:y=16,` +
        `pad=${collagePanelW}:${collageH}:0:0:black,` +
        `drawbox=x=0:y=${collageH - collageLabelH}:w=iw:h=${collageLabelH}:color=${event.color}@1:t=fill,` +
        `drawtext=${drawtextBase}text='${event.label}':fontcolor=black:fontsize=30:x=(w-text_w)/2:y=${collageH - collageLabelH + 10}[c_${event.key}]`
      );
    }
    collageFilters.push(
      `${collageEvents.map((event) => `[c_${event.key}]`).join("")}hstack=inputs=2,` +
      `pad=${collagePanelW * 2}:${collageH + 58}:0:58:0x101820,` +
      `drawbox=x=0:y=0:w=iw:h=58:color=black@1:t=fill,` +
      `drawtext=${drawtextBase}text='${safeSwingLabel}':fontcolor=white:fontsize=26:x=(w-text_w)/2:y=15,` +
      `format=yuvj420p[collage]`
    );
    runCmd("ffmpeg", [
      "-y", "-i", pitchPath, "-i", swingPath,
      "-filter_complex_threads", "1",
      "-filter_complex", collageFilters.join(";"),
      "-map", "[collage]", "-frames:v", "1", "-q:v", "2", collagePath,
    ]);

    return {
      blob: fs.readFileSync(outputPath),
      thumb: extractLastFrameJpeg(outputPath),
      collage: fs.readFileSync(collagePath),
    };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  }
}

// Serialize render requests to avoid CPU oversubscription, without blocking HTTP.
let queue=Promise.resolve();
function buildMatchupVideoAsync(input){
  const job=queue.then(()=>new Promise((resolve,reject)=>{
    const worker=new Worker(__filename,{workerData:{matchup:input}});let received=false;
    worker.once('message',message=>{
      received=true;
      if(message.error){reject(new Error(message.error));return;}
      resolve(Object.fromEntries(Object.entries(message.result).map(([key,value])=>[key,value==null?null:Buffer.from(value)])));
    });
    worker.once('error',reject);
    worker.once('exit',code=>{if(!received)reject(new Error(`Matchup renderer exited before completing (${code}). Please retry.`));});
  }));
  queue=job.catch(()=>{});return job;
}
if(!isMainThread&&workerData?.matchup){
  try{parentPort.postMessage({result:buildMatchupVideoServerSide(workerData.matchup)});}
  catch(error){parentPort.postMessage({error:error.message||String(error)});}
}
module.exports={buildMatchupVideoServerSide,buildMatchupVideoAsync,ffprobeMeta};
