const state = {
  fileName: null,
  contactTime: null,
  contactFrameTime: null,
  contactTimingMode: "ON_FRAME",
  contactTimingChoice: "ON_FRAME",
  videoFile: null,
  videoObjectUrl: null,
  videoMetadata: {},
  frameStepS: 1 / 30,
  observations: [],
  autoObservations: [],
  showAutoTrack: true,
  detectionAccepted: false,
  ballDetectionReadyAlerted: false,
  ballPathAudioStarted: false,
  landmarks: [],
  pendingLandmarks: [],
  distanceCertainty: 'guess',
  terminalEvent: null,
  apexEvent: null,
  latestPrediction: null,
  gameframe: {
    teams: [],
    hitters: [],
    savedHits: [],
    selectedEvHitIds: new Set(),
    libraryNotice: "",
  },
  flightView: {
    visible: false,
    zoom: 1,
    panX: 0,
    panY: 0,
    yaw: 0,
    pitch: 1.05,
    roll: 0,
    time: 0,
    playing: false,
    lastAnimationTime: 0,
    animationFrame: null,
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
    dragOriginYaw: 0,
    dragOriginPitch: 1.05,
    dragOriginRoll: 0,
    dragButton: 0,
  },
};

const els = {
  file: document.getElementById("video-file"),
  menuScrim: document.getElementById("menu-scrim"),
  evLibraryPanel: document.getElementById("ev-library-panel"),
  evLibraryList: document.getElementById("ev-library-list"),
  evLibraryStatus: document.getElementById("ev-library-status"),
  evLibrarySearch: document.getElementById("ev-library-search"),
  evLibrarySelectVisible: document.getElementById("ev-library-select-visible"),
  evLibraryClearSelection: document.getElementById("ev-library-clear-selection"),
  evLibraryDeleteSelected: document.getElementById("ev-library-delete-selected"),
  libraryOverviewModal: document.getElementById("library-overview-modal"),
  libraryOverviewText: document.getElementById("library-overview-text"),
  libraryOverviewStatus: document.getElementById("library-overview-status"),
  copyLibraryOverview: document.getElementById("copy-library-overview"),
  closeLibraryOverview: document.getElementById("close-library-overview"),
  openEvLibrary: document.getElementById("open-ev-library"),
  closeEvLibrary: document.getElementById("close-ev-library"),
  packageFile: document.getElementById("package-file"),
  setupModal: document.getElementById("setup-modal"),
  setupControls: document.getElementById("hit-setup-controls"),
  setupControlsHome: document.getElementById("setup-controls-home"),
  setupControlsSlot: document.getElementById("setup-controls-slot"),
  workflowViewerSlot: document.getElementById("workflow-viewer-slot"),
  setupTitle: document.getElementById("setup-title"),
  setupCopy: document.getElementById("setup-copy"),
  setupStepLabel: document.getElementById("setup-step-label"),
  setupBack: document.getElementById("setup-back"),
  setupCancel: document.getElementById("setup-cancel"),
  setupSecondary: document.getElementById("setup-secondary"),
  setupContinue: document.getElementById("setup-continue"),
  video: document.getElementById("video"),
  overlay: document.getElementById("overlay"),
  estimateBanner: document.getElementById("estimate-banner"),
  estimateDescription: document.getElementById("estimate-description"),
  estimateSummary: document.getElementById("estimate-summary"),
  viewerPanel: document.querySelector(".viewer-panel"),
  viewer: document.getElementById("viewer"),
  backFrame: document.getElementById("back-frame"),
  forwardFrame: document.getElementById("forward-frame"),
  playPause: document.getElementById("play-pause"),
  timeline: document.getElementById("timeline"),
  currentTime: document.getElementById("current-time"),
  relativeTime: document.getElementById("relative-time"),
  frameIndex: document.getElementById("frame-index"),
  setContact: document.getElementById("set-contact"),
  detectContactAudio: document.getElementById("detect-contact-audio"),
  contactAudioStatus: document.getElementById("contact-audio-status"),
  contactAudioLeadFrames: document.getElementById("contact-audio-lead-frames"),
  clearContact: document.getElementById("clear-contact"),
  contactConfidence: document.getElementById("contact-confidence"),
  clickMode: document.getElementById("click-mode"),
  modeBall: document.getElementById("mode-ball"),
  modeLandmark: document.getElementById("mode-landmark"),
  modeTerminal: document.getElementById("mode-terminal"),
  modeEraser: document.getElementById("mode-eraser"),
  pointSource: document.getElementById("point-source"),
  pointConfidence: document.getElementById("point-confidence"),
  uncertainty: document.getElementById("uncertainty"),
  pointNote: document.getElementById("point-note"),
  undoObservation: document.getElementById("undo-observation"),
  suggestLandmarks: document.getElementById("suggest-landmarks"),
  acceptLandmarkSuggestions: document.getElementById("accept-landmark-suggestions"),
  rejectLandmarkSuggestions: document.getElementById("reject-landmark-suggestions"),
  showAutoTrack: document.getElementById("show-auto-track"),
  acceptAutoTrack: document.getElementById("accept-auto-track"),
  clearAutoTrack: document.getElementById("clear-auto-track"),
  autoTrackStatus: document.getElementById("auto-track-status"),
  landmarkStatus: document.getElementById("landmark-status"),
  landmarkType: document.getElementById("landmark-type"),
  terminalType: document.getElementById("terminal-type"),
  terminalUncertaintyFrames: document.getElementById("terminal-uncertainty-frames"),
  setGroundFrame: document.getElementById("set-ground-frame"),
  clearGroundContact: document.getElementById("clear-ground-contact"),
  hitDescription: document.getElementById("hit-description"),
  gameframeTeam: document.getElementById("gameframe-team"),
  gameframeHitter: document.getElementById("gameframe-hitter"),
  fieldSize: document.getElementById("field-size"),
  newTeamName: document.getElementById("new-team-name"),
  newHitterName: document.getElementById("new-hitter-name"),
  addTeam: document.getElementById("add-team"),
  addHitter: document.getElementById("add-hitter"),
  saveHitTrack: document.getElementById("save-hit-track"),
  gameframeSaveStatus: document.getElementById("gameframe-save-status"),
  cameraVantage: document.getElementById("camera-vantage"),
  direction: document.getElementById("direction"),
  fieldTool: document.getElementById("field-tool"),
  expandFieldTool: document.getElementById("expand-field-tool"),
  openActualFieldMap: document.getElementById("open-actual-field-map"),
  closeFieldTool: document.getElementById("close-field-tool"),
  cameraMarker: document.getElementById("camera-marker"),
  landingMarker: document.getElementById("landing-marker"),
  actualFieldMapModal: document.getElementById("actual-field-map-modal"),
  actualFieldSearch: document.getElementById("actual-field-search"),
  actualFieldSearchButton: document.getElementById("actual-field-search-button"),
  actualFieldSavedLocation: document.getElementById("actual-field-saved-location"),
  actualFieldMapStatus: document.getElementById("actual-field-map-status"),
  actualFieldMap: document.getElementById("actual-field-map"),
  actualMapCameraStep: document.getElementById("actual-map-camera-step"),
  actualMapHomeStep: document.getElementById("actual-map-home-step"),
  actualMapAxisStep: document.getElementById("actual-map-axis-step"),
  actualMapLandingStep: document.getElementById("actual-map-landing-step"),
  actualMapReset: document.getElementById("actual-map-reset"),
  actualMapDistance: document.getElementById("actual-map-distance"),
  actualMapDirection: document.getElementById("actual-map-direction"),
  actualMapBackDiagram: document.getElementById("actual-map-back-diagram"),
  actualMapContinue: document.getElementById("actual-map-continue"),
  cameraHeightFt: document.getElementById("camera-height-ft"),
  distanceFt: document.getElementById("distance-ft"),
  distanceUncertaintyFt: document.getElementById("distance-uncertainty-ft"),
  setApexFrame: document.getElementById("set-apex-frame"),
  clearApexFrame: document.getElementById("clear-apex-frame"),
  apexStatus: document.getElementById("apex-status"),
  downloadJson: document.getElementById("download-json"),
  downloadCsv: document.getElementById("download-csv"),
  downloadClip: document.getElementById("download-clip"),
  openSimulation: document.getElementById("open-simulation"),
  openWorkflow: document.getElementById("open-workflow"),
  toggleDataRecords: document.getElementById("toggle-data-records"),
  dataRecords: document.getElementById("data-records"),
  clipProgressWrap: document.getElementById("clip-progress-wrap"),
  clipProgress: document.getElementById("clip-progress"),
  clipProgressText: document.getElementById("clip-progress-text"),
  loadedOnlySections: Array.from(document.querySelectorAll(".loaded-only")).filter(
    (element) => !element.closest("#sidebar-deleted-controls"),
  ),
  loadPrediction: document.getElementById("load-prediction"),
  predictionModal: document.getElementById("prediction-modal"),
  closePrediction: document.getElementById("close-prediction"),
  predictionStatus: document.getElementById("prediction-status"),
  predictionWarning: document.getElementById("prediction-warning"),
  predictionUnconstrained: document.getElementById("prediction-unconstrained"),
  showFlightView: document.getElementById("show-flight-view"),
  resetFlightView: document.getElementById("reset-flight-view"),
  flightViewer: document.getElementById("flight-viewer"),
  flightSvg: document.getElementById("flight-svg"),
  flightCanvas: document.getElementById("flight-canvas"),
  flightHud: document.getElementById("flight-hud"),
  flightVideoView: document.getElementById("flight-video-view"),
  flightTopView: document.getElementById("flight-top-view"),
  flightSideView: document.getElementById("flight-side-view"),
  flightBehindView: document.getElementById("flight-behind-view"),
  flightPlay: document.getElementById("flight-play"),
  flightTime: document.getElementById("flight-time"),
  observationsBody: document.getElementById("observations-body"),
  observationCount: document.getElementById("observation-count"),
  landmarksBody: document.getElementById("landmarks-body"),
  landmarkCount: document.getElementById("landmark-count"),
  terminalBody: document.getElementById("terminal-body"),
  terminalStatus: document.getElementById("terminal-status"),
};

const ctx = els.overlay.getContext("2d");

const viewerHome = els.viewerPanel.parentElement;
const viewerPlaceholder = document.createComment("viewer-panel-home");
viewerHome.insertBefore(viewerPlaceholder, els.viewerPanel.nextSibling);

const markers = {
  camera: { x: 34, y: 86 },
  landing: { x: 38, y: 27 },
};

const actualFieldMapState = {
  map: null,
  mode: "camera",
  camera: null,
  home: null,
  axis: null,
  landing: null,
  cameraMarker: null,
  homeMarker: null,
  axisMarker: null,
  landingMarker: null,
  cameraLine: null,
  axisLine: null,
  landingLine: null,
  distanceFt: null,
  signedDirectionDeg: null,
  fieldGeometry: null,
  evidenceImageDataUrl: null,
  autoContinuing: false,
};

const ACTUAL_FIELD_SAVED_LOCATIONS_KEY = "gameframe.ev.actualFieldSavedLocations.v1";

const LANDMARK_SEQUENCE = [
  "home_plate",
  "pitching_rubber",
  "first_baseline_near", "first_baseline_far",
  "third_baseline_near", "third_baseline_far",
];

const FIELD_PROFILES = {
  "43_60_softball": { key: "43_60_softball", label: "43/60 softball", moundFt: 43, baseFt: 60, fenceFt: 200, rings: [100, 150, 175, 200], guideFt: 225 },
  "45_60": { key: "45_60", label: "45/60", moundFt: 45, baseFt: 60, fenceFt: 225, rings: [100, 150, 200, 225], guideFt: 250 },
  "50_70": { key: "50_70", label: "50/70", moundFt: 50, baseFt: 70, fenceFt: 250, rings: [150, 200, 225, 250], guideFt: 280 },
  "60_90": { key: "60_90", label: "60/90", moundFt: 60.5, baseFt: 90, fenceFt: 400, rings: [250, 300, 350, 400], guideFt: 430 },
};

const ACTUAL_FIELD_MAP_DISTANCE_UNCERTAINTY_FT = 12;

function round(value, digits = 3) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Number(number.toFixed(digits));
}

function formatNumber(value, digits = 1, suffix = "", fallback = "not available") {
  const rounded = round(value, digits);
  if (rounded === null) return fallback;
  return `${rounded.toFixed(digits)}${suffix}`;
}

function currentStep() {
  const step = Number(state.frameStepS);
  return Number.isFinite(step) && step > 0 ? step : 1 / 30;
}

function setFrameStepFromMetadata(metadata = state.videoMetadata || {}) {
  const savedStep = Number(metadata.frame_step_assumption_s);
  const savedFps = Number(metadata.fps || metadata.frame_rate_fps);
  if (Number.isFinite(savedStep) && savedStep > 0) {
    state.frameStepS = savedStep;
  } else if (Number.isFinite(savedFps) && savedFps > 0) {
    state.frameStepS = 1 / savedFps;
  } else {
    state.frameStepS = 1 / 30;
  }
}

let presentedVideoFrame=null;
if(typeof els.video.requestVideoFrameCallback==='function'){
  const observe=(now,metadata)=>{presentedVideoFrame={source:els.video.currentSrc,time:metadata.mediaTime};els.video.requestVideoFrameCallback(observe);};
  els.video.requestVideoFrameCallback(observe);
  els.video.addEventListener('loadstart',()=>{presentedVideoFrame=null;});
}
function displayedFrameTime(time=els.video.currentTime) {
  if(arguments.length===0&&presentedVideoFrame?.source===els.video.currentSrc&&Number.isFinite(presentedVideoFrame.time)&&Math.abs(presentedVideoFrame.time-time)<=currentStep()*1.5)return presentedVideoFrame.time;
  const frames=state.frameTimes || [];
  const before=frames.filter(t=>t<=time+.00001).at(-1);
  return before !== undefined && time-before < Math.max(.1,currentStep()*2) ? before : time;
}

function adjacentFrameTime(frameCount, reference=displayedFrameTime()) {
  const frames=state.frameTimes || [];
  const index=frames.findIndex(t=>Math.abs(t-reference)<.0001);
  if(index>=0 && index+frameCount>=0 && index+frameCount<frames.length) return frames[index+frameCount];
  return Math.max(0,reference+frameCount*currentStep());
}

function frameIntervalAt(time=displayedFrameTime()) {
  return Math.max(currentStep(), time-adjacentFrameTime(-1,time), adjacentFrameTime(1,time)-time);
}

let videoTimingRequest=0, videoTimingTask=null, videoTimingFile=null;
async function refreshVideoTiming(reference=els.video.currentTime || 0) {
  const file=state.videoFile;
  if (!file) return;
  const covered=()=>videoTimingFile===file && state.frameTimes?.length>1 &&
    reference>=state.frameTimes[0] && reference<=state.frameTimes.at(-1)-currentStep()*.5;
  if(covered())return;
  if(videoTimingTask?.file===file){
    await videoTimingTask.promise;
    if(file===state.videoFile && !covered())return refreshVideoTiming(reference);
    return;
  }
  const entry={file,promise:null};videoTimingTask=entry;
  entry.promise=(async()=>{
  const request=++videoTimingRequest;
  state.videoTimingBusy=true;
  try {
    const response=await fetch('/api/gameframe/video-timing',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({file_name:file.name,file_size:file.size,source_path:state.videoMetadata.source_path,reference_time_s:reference})});
    if(!response.ok) return;
    const timing=await response.json();
    if(file!==state.videoFile || request!==videoTimingRequest || !timing.frame_times_s?.length) return;
    videoTimingFile=file;
    state.frameTimes=timing.frame_times_s;
    state.videoMetadata={...state.videoMetadata,...timing};
    setFrameStepFromMetadata(timing);
    const contactFrame=state.contactFrameTime;
    if(state.contactTime !== null && state.contactTimingMode === "BETWEEN_FRAMES" &&
        contactFrame >= state.frameTimes[0] && contactFrame <= state.frameTimes.at(-1)) {
      const actualFrame=displayedFrameTime(contactFrame);
      const instant=(actualFrame+adjacentFrameTime(-1,actualFrame))/2;
      if(Math.abs(instant-state.contactTime)>1e-6) setContactTime(instant,{frameTime:actualFrame,mode:"BETWEEN_FRAMES"});
    }
    if(state.contactTime!==null && state.contactTimingMode!=="BETWEEN_FRAMES" &&
        contactFrame>=state.frameTimes[0] && contactFrame<=state.frameTimes.at(-1)){
      const uncertainty=frameIntervalAt(contactFrame)/2;
      if(Math.abs(uncertainty-state.contactUncertaintyS)>1e-6){
        state.contactUncertaintyS=uncertainty;
        if(state.terminalEvent){state.terminalEvent.contact_uncertainty_s=uncertainty;
          state.terminalEvent.timing_uncertainty_s=round((state.terminalEvent.landing_time_uncertainty_s??currentStep())+uncertainty,6);}
        markPredictionStale();persistDraft();
      }
    }
    syncTimeline();
  } catch (_) { /* Keep the declared frame interval when the source cannot be probed. */ }
  finally {
    if(videoTimingTask===entry)videoTimingTask=null;
    if(file===state.videoFile) {
      state.videoTimingBusy=false;
      if(state.frameTimes?.length && Math.abs((els.video.currentTime || 0)-reference)>.5 &&
          ((els.video.currentTime || 0)<state.frameTimes[0] || (els.video.currentTime || 0)>state.frameTimes.at(-1))) {
        setTimeout(()=>refreshVideoTiming(),0);
      }
    }
  }
  })();
  return entry.promise;
}

function currentFrameIndex() {
  const prepared=selectionPreparation?.file===state.videoFile?selectionPreparation.session:null;
  if(prepared?.frameNumbers){const index=prepared.times.findIndex(t=>Math.abs(t-els.video.currentTime)<currentStep()*.5);if(index>=0)return prepared.frameNumbers[index];}
  return Math.round(els.video.currentTime / currentStep());
}

function relativeTime(time = els.video.currentTime) {
  return state.contactTime === null ? null : time - state.contactTime;
}

function renderMetrics() {
  const time = els.video.currentTime || 0;
  els.currentTime.textContent = `${round(time, 3).toFixed(3)} s`;
  els.frameIndex.textContent = String(currentFrameIndex());
  syncTimeline();
  const rel = relativeTime(time);
  els.relativeTime.textContent =
    rel === null ? "contact not set" : `${round(rel, 3).toFixed(3)} s`;
}

function syncTimeline() {
  const duration = Number(els.video.duration);
  const hasDuration = Number.isFinite(duration) && duration > 0;
  els.timeline.disabled = !hasDuration;
  els.timeline.min = "0";
  els.timeline.max = hasDuration ? String(duration) : "0";
  els.timeline.step = String(currentStep());
  els.timeline.value = hasDuration ? String(Math.min(els.video.currentTime || 0, duration)) : "0";
}

function seekVideoByFrames(frameCount) {
  if(nativeBallAssist.phase==='review'){
    return;
  }
  dismissMarkingPrompts(els.viewerPanel);
  const duration = Number(els.video.duration);
  if (!Number.isFinite(duration) || duration <= 0) return;
  els.video.pause();
  const nextTime = Math.min(duration, Math.max(0, adjacentFrameTime(frameCount)));
  els.video.currentTime = nextTime;
  syncTimeline();
  renderMetrics();
  renderOverlay();
}

function seekVideoTo(time) {
  const duration = Number(els.video.duration);
  if (!Number.isFinite(duration) || duration <= 0) return;
  els.video.pause();
  els.video.currentTime = Math.min(duration, Math.max(0, time));
  syncTimeline();
  renderMetrics();
  renderOverlay();
}

function isTypingTarget(element) {
  const tag = element?.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || element?.isContentEditable;
}

function setClickMode(mode) {
  if (!["ball", "landmark", "terminal", "eraser"].includes(mode)) mode = "ball";
  els.clickMode.value = mode;
  els.modeBall.classList.toggle("active", mode === "ball");
  els.modeLandmark.classList.toggle("active", mode === "landmark");
  els.modeTerminal.classList.toggle("active", mode === "terminal");
  els.modeEraser.classList.toggle("active", mode === "eraser");
  els.overlay.style.cursor = mode === "eraser" ? "cell" : "crosshair";

}

function syncCanvasSize() {
  // CSS viewing zoom must never resize the coordinate canvas or compound itself.
  const rect = {width: els.video.clientWidth, height: els.video.clientHeight};
  els.overlay.style.width = `${rect.width}px`;
  els.overlay.style.height = `${rect.height}px`;
  els.overlay.width = Math.max(1, Math.round(rect.width * window.devicePixelRatio));
  els.overlay.height = Math.max(1, Math.round(rect.height * window.devicePixelRatio));
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  renderOverlay();
}

const groundView = { zoom: 1, x: 0, y: 0 };

function updateGroundView() {
  const rect = els.overlay.getBoundingClientRect();
  const limitX = rect.width * (groundView.zoom - 1) / 2;
  const limitY = rect.height * (groundView.zoom - 1) / 2;
  groundView.x = Math.max(-limitX, Math.min(limitX, groundView.x));
  groundView.y = Math.max(-limitY, Math.min(limitY, groundView.y));
  els.video.style.transformOrigin = "50% 50%";
  els.video.style.transform = `translate(${groundView.x}px, ${groundView.y}px) scale(${groundView.zoom})`;
  els.overlay.style.touchAction = groundView.zoom > 1 ? "none" : "";
  els.overlay.style.cursor = "crosshair";
  document.getElementById("ground-view-zoom").value = groundView.zoom;
  document.getElementById("ground-view-zoom-label").textContent = `${groundView.zoom}x`;
  renderOverlay();
}

function syncGroundView(step) {
  document.getElementById("ground-view-controls").hidden = step !== "ground";
  if (step !== "ground") Object.assign(groundView, {zoom: 1, x: 0, y: 0});
  updateGroundView();
}

function renderedVideoRect() {
  const rect = els.overlay.getBoundingClientRect();
  const videoWidth = els.video.videoWidth || 0;
  const videoHeight = els.video.videoHeight || 0;
  if (!rect.width || !rect.height || !videoWidth || !videoHeight) {
    return { left: 0, top: 0, width: rect.width || 1, height: rect.height || 1 };
  }

  const elementAspect = rect.width / rect.height;
  const videoAspect = videoWidth / videoHeight;
  if (elementAspect > videoAspect) {
    const width = rect.height * videoAspect;
    return {
      left: (rect.width - width) / 2,
      top: 0,
      width,
      height: rect.height,
    };
  }

  const height = rect.width / videoAspect;
  return {
    left: 0,
    top: (rect.height - height) / 2,
    width: rect.width,
    height,
  };
}

function displayToVideoPoint(event) {
  const rect = els.overlay.getBoundingClientRect();
  const videoRect = renderedVideoRect();
  const xDisplay = (event.clientX - rect.left - rect.width / 2 - groundView.x) / groundView.zoom + rect.width / 2 - videoRect.left;
  const yDisplay = (event.clientY - rect.top - rect.height / 2 - groundView.y) / groundView.zoom + rect.height / 2 - videoRect.top;
  const scaleX = els.video.videoWidth / videoRect.width;
  const scaleY = els.video.videoHeight / videoRect.height;
  return {
    x: xDisplay * scaleX,
    y: yDisplay * scaleY,
  };
}

function videoToDisplayPoint(x, y) {
  const videoRect = renderedVideoRect();
  const rect = els.overlay.getBoundingClientRect();
  return {
    x: (videoRect.left + (x / els.video.videoWidth) * videoRect.width - rect.width / 2) * groundView.zoom + rect.width / 2 + groundView.x,
    y: (videoRect.top + (y / els.video.videoHeight) * videoRect.height - rect.height / 2) * groundView.zoom + rect.height / 2 + groundView.y,
  };
}

function visibleObservationsFromCurrentTimeOnward() {
  const t = els.video.currentTime;
  const tolerance = Math.min(0.004, currentStep() * 0.12);
  return state.observations.filter(
    (obs) => obs.image_x !== null && obs.video_time_s !== null && obs.video_time_s <= t + tolerance,
  );
}

function visibleObservationsNearCurrentTime() {
  const t = els.video.currentTime;
  const tolerance = Math.max(currentStep() * 0.55, 0.01);
  const futureSlack = Math.min(0.004, currentStep() * 0.12);
  return state.observations.filter(
    (obs) => obs.image_x !== null && obs.video_time_s !== null
      && obs.video_time_s <= t + futureSlack
      && Math.abs(obs.video_time_s - t) <= tolerance,
  );
}

function observationsErasableAtCurrentTime() {
  const t = els.video.currentTime;
  const tolerance = Math.max(currentStep() * 0.55, 0.01);
  return state.observations.filter(
    (obs) => obs.image_x !== null && obs.video_time_s !== null
      && obs.video_time_s <= t + tolerance
      && Math.abs(obs.video_time_s - t) <= tolerance,
  );
}

function autoObservationsWithImagePoints() {
  return state.autoObservations.filter((obs) => obs.image_x !== null && obs.image_y !== null);
}

function visibleAutoObservationsFromCurrentTimeOnward() {
  if (activeWorkflowStep === "ballPath") {
    return autoObservationsWithImagePoints();
  }
  const t = els.video.currentTime;
  const tolerance = Math.min(0.004, currentStep() * 0.12);
  return autoObservationsWithImagePoints().filter(
    (obs) => obs.video_time_s !== null && obs.video_time_s <= t + tolerance,
  );
}

function visibleAutoObservationsNearCurrentTime() {
  const t = els.video.currentTime;
  const tolerance = Math.max(currentStep() * 0.65, 0.014);
  const futureSlack = Math.min(0.004, currentStep() * 0.12);
  return autoObservationsWithImagePoints().filter(
    (obs) => obs.video_time_s !== null
      && obs.video_time_s <= t + futureSlack
      && Math.abs(obs.video_time_s - t) <= tolerance,
  );
}

function autoObservationsErasableAtCurrentTime() {
  const t = els.video.currentTime;
  const tolerance = Math.max(currentStep() * 0.65, 0.014);
  return autoObservationsWithImagePoints().filter(
    (obs) => obs.video_time_s !== null
      && obs.video_time_s <= t + tolerance
      && Math.abs(obs.video_time_s - t) <= tolerance,
  );
}

function fittedDisplayLine(points) {
  if (points.length < 2) return points.map(({ point }) => point);
  const first = points[0].point;
  const last = points.at(-1).point;
  let dirX = last.x - first.x;
  let dirY = last.y - first.y;
  let norm = Math.hypot(dirX, dirY);
  if (norm < 1e-6) {
    const mean = points.reduce((acc, { point }) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
    mean.x /= points.length;
    mean.y /= points.length;
    dirX = mean.x - first.x;
    dirY = mean.y - first.y;
    norm = Math.hypot(dirX, dirY);
  }
  if (norm < 1e-6) return points.map(({ point }) => point);
  dirX /= norm;
  dirY /= norm;
  return points.map(({ point }) => {
    const along = (point.x - first.x) * dirX + (point.y - first.y) * dirY;
    return {
      x: first.x + dirX * along,
      y: first.y + dirY * along,
    };
  });
}

function drawTagCrosshair(x, y, color, size = 8) {
  ctx.save();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x - size, y); ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size); ctx.lineTo(x, y + size);
  ctx.strokeStyle = '#101b17'; ctx.lineWidth = 4; ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
}

function videoTagLabel(landmark) {
  if (landmark.estimate_kind === 'MOUND_TOP_APPROXIMATION') return 'Mound (approx.)';
  return ({home_plate:'Home plate',pitching_rubber:'Rubber',first_baseline_near:'First line 1',first_baseline_far:'First line 2',third_baseline_near:'Third line 1',third_baseline_far:'Third line 2'})[landmark.landmark] || landmark.landmark;
}

function drawAutoTrackOverlay() {
  if (!state.showAutoTrack || state.autoObservations.length === 0 || !els.video.videoWidth) return;
  const points = visibleAutoObservationsNearCurrentTime().map((obs) => ({
    obs,
    point: videoToDisplayPoint(obs.image_x, obs.image_y),
  }));
  if (points.length === 0) return;

  ctx.save();
  // Image coordinates belong to their own video frame. Never fit a screen-space
  // line through points from different camera positions or times.

  for (const obs of visibleAutoObservationsNearCurrentTime()) {
    const point = videoToDisplayPoint(obs.image_x, obs.image_y);
    drawTagCrosshair(point.x, point.y, '#ffffff');
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText("CV", point.x + 12, point.y + 4);
  }
  ctx.restore();
}

function drawContactReviewPicture(){
  if(els.video.readyState<2)return;
  if(!nativeBallAssist.contactPicture){
    if(els.video.seeking||Math.abs(displayedFrameTime()-contactCalibrationTime())>currentStep()*.6)return;
    const picture=document.createElement('canvas');picture.width=Math.min(1280,els.video.videoWidth);picture.height=Math.round(els.video.videoHeight*picture.width/els.video.videoWidth);
    picture.getContext('2d').drawImage(els.video,0,0,picture.width,picture.height);nativeBallAssist.contactPicture=picture;
  }
  const points=nativeBallAssist.points,contact=state.observations.find(p=>p.role==='CONTACT_POINT');
  const {scale,dx,dy}=GameFrameContactPicture.layout(els.video.videoWidth,els.video.videoHeight,points,els.overlay.width,els.overlay.height);
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#101b17';ctx.fillRect(0,0,els.overlay.width,els.overlay.height);
  ctx.drawImage(nativeBallAssist.contactPicture,dx,dy,els.video.videoWidth*scale,els.video.videoHeight*scale);
  const mark=(x,y,label,color)=>{x=dx+x*scale;y=dy+y*scale;drawTagCrosshair(x,y,color);ctx.font='bold 13px Arial';ctx.lineWidth=4;ctx.strokeStyle='#101b17';ctx.strokeText(label,x+10,y-7);ctx.fillStyle=color;ctx.fillText(label,x+10,y-7);};
  points.forEach((point,index)=>mark(point.reference_image_x,point.reference_image_y,String(index+1),'#ffd166'));
  if(contact)mark(contact.image_x,contact.image_y,'Contact','#6ee2aa');
  ctx.restore();
}
function renderOverlay() {
  if(nativeBallAssist.phase==='review'&&activeWorkflowStep==='ballPath'){drawContactReviewPicture();return;}
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, els.overlay.width, els.overlay.height);
  ctx.restore();
  ctx.setLineDash([]);
  ctx.beginPath();

  drawAutoTrackOverlay();

  const visibleObservations = (nativeBallAssist.phase==='review'?visibleObservationsNearCurrentTime():visibleObservationsFromCurrentTimeOnward()).filter(obs=>obs.source!=='COMPUTER_VISION'||visibleObservationsNearCurrentTime().includes(obs));
  const pathPoints = visibleObservations
    .filter(obs=>obs.source!=='COMPUTER_VISION')
    .sort((a, b) => a.video_time_s - b.video_time_s)
    .map((obs) => videoToDisplayPoint(obs.image_x, obs.image_y));
  if (pathPoints.length > 1) {
    ctx.save();
    ctx.beginPath();
    pathPoints.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = "rgba(239, 71, 111, 0.45)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  for (const obs of visibleObservations) {
    const point = videoToDisplayPoint(obs.image_x, obs.image_y);
    const isCurrent = visibleObservationsNearCurrentTime().includes(obs);
    drawTagCrosshair(point.x, point.y, isCurrent ? '#ffd166' : 'rgba(255, 209, 102, 0.58)');
  }

  if (els.clickMode.value === "landmark" || els.clickMode.value === "eraser") {
    for (const landmark of state.pendingLandmarks) {
      const point = videoToDisplayPoint(landmark.image_x, landmark.image_y);
      ctx.save();
      drawTagCrosshair(point.x, point.y, '#f59e0b');
      ctx.font = "12px sans-serif";
      ctx.fillStyle = "#fef3c7";
      ctx.fillText(videoTagLabel(landmark), point.x + 10, point.y - 10);
      ctx.restore();
    }
    for (const landmark of state.landmarks) {
      const point = videoToDisplayPoint(landmark.image_x, landmark.image_y);
      drawTagCrosshair(point.x, point.y, '#38bdf8');
      ctx.font = "12px sans-serif";
      ctx.fillStyle = "#e0f2fe";
      ctx.fillText(videoTagLabel(landmark), point.x + 9, point.y - 9);
    }
  }

  const terminalVisible =
    state.terminalEvent !== null
    && state.terminalEvent.image_x !== null
    && state.terminalEvent.video_time_s !== null
    && state.terminalEvent.video_time_s <= (els.video.currentTime || 0) + Math.max(currentStep() * 0.55, 0.01);
  if (terminalVisible) {
    const point = videoToDisplayPoint(state.terminalEvent.image_x, state.terminalEvent.image_y);
    drawTagCrosshair(point.x, point.y, '#fb923c');
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#ffedd5";
    ctx.fillText(state.terminalEvent.type, point.x + 15, point.y + 15);
  }
}

function updateAutoTrackStatus() {
  if (state.detectionAccepted) {
    els.autoTrackStatus.textContent = "Detection accepted.";
    syncDetectFlightButtons();
    return;
  }
  const count = state.autoObservations.length;
  if (count === 0) {
    const readiness = ballDetectionSeedReadiness();
    els.autoTrackStatus.textContent = readiness.message;
    syncDetectFlightButtons();
    return;
  }
  const cvCount = state.autoObservations.filter((obs) => obs.source === "COMPUTER_VISION").length;
  const mediumCount = state.autoObservations.filter((obs) => obs.confidence === "MEDIUM").length;
  els.autoTrackStatus.textContent =
    `${count} detected points loaded (${cvCount} CV, ${mediumCount} medium confidence).`;
  syncDetectFlightButtons();
}

function manualBallObservations() {
  return state.observations
    .filter((obs) => isManualBallObservation(obs)
      && Number.isFinite(Number(obs.image_x))
      && Number.isFinite(Number(obs.image_y))
      && Number.isFinite(Number(obs.relative_time_s)))
    .sort((a, b) => Number(a.relative_time_s || 0) - Number(b.relative_time_s || 0));
}

let nativeBallAssist = {phase:'idle',generation:0,job:null,controller:null,points:[]};
const prepareNativeRawFrames = window.GameFrameRawFrames.createFramePreparation();
let nativeSourcePreparation=null;
async function prepareNativeSource(identity,signal){
  if(nativeSourcePreparation?.identity===identity&&!nativeSourcePreparation.signal?.aborted)return nativeSourcePreparation.promise;
  const entry={identity,signal,promise:null};nativeSourcePreparation=entry;
  entry.promise=(async()=>{
    const file=state.videoFile||await(await fetch(els.video.currentSrc,{signal})).blob();
    const form=new FormData();form.append('video',file,state.fileName||file.name||'hit.mp4');
    form.append('streamed','1');form.append('source_fps',String(1/currentStep()));
    form.append('width',String(els.video.videoWidth));form.append('height',String(els.video.videoHeight));
    const response=await fetch('/api/ball-assist/session',{method:'POST',body:form,signal});
    const data=await response.json();if(!response.ok)throw Error(data.error||'Could not prepare the source video.');
    return data;
  })().catch(error=>{if(nativeSourcePreparation===entry)nativeSourcePreparation=null;throw error;});
  return entry.promise;
}

function stopNativeBallAssist() {
  nativeBallAssist.generation++;
  nativeBallAssist.controller?.abort();nativeBallAssist.controller=null;
  if(nativeBallAssist.job)fetch('/api/ball-assist/jobs/'+encodeURIComponent(nativeBallAssist.job),{method:'DELETE'}).catch(()=>{});
  nativeBallAssist.job=null;nativeBallAssist.phase='idle';nativeBallAssist.points=[];
  nativeBallAssist.contactPicture=null;
}
function useRegularIntervalTagging() {
  stopNativeBallAssist();nativeBallAssist.phase='manual';
  state.autoObservations=[];state.detectionAccepted=false;state.ballAssistAccepted=false;
  state.showAutoTrack=false;els.showAutoTrack.checked=false;
  renderObservations();renderOverlay();persistDraft();goToWorkflowStep('ballPath');
}
function acceptNativeBallAssist() {
  if(nativeBallAssist.phase!=='review'||!nativeBallAssist.points.length)return;
  state.autoObservations=nativeBallAssist.points;
  // Acceptance is explicit. Preserve detector provenance on every flight point.
  nativeBallAssist.phase='accepted';state.ballAssistAccepted=true;
  acceptAutoTrack();goToWorkflowStep('landmarks');
}
function renderNativeBallAssist() {
  const running=nativeBallAssist.phase==='running';
  setWorkflowVideoPrompt('');
  els.setupTitle.textContent=running?'Detecting the ball path…':'Does this look right?';
  els.setupContinue.hidden=true;
  els.setupControlsSlot.replaceChildren();
}
async function beginNativeBallAssist() {
  stopNativeBallAssist();nativeBallAssist.phase='running';
  const generation=nativeBallAssist.generation,controller=new AbortController();nativeBallAssist.controller=controller;
  const contact=state.observations.find(p=>p.role==='CONTACT_POINT'||Math.abs(p.relative_time_s)<.014);
  if(!contact||!Number.isFinite(contact.image_x)||!Number.isFinite(contact.image_y)){useRegularIntervalTagging();return;}
  const frameTime=contactCalibrationTime(),width=els.video.videoWidth,height=els.video.videoHeight;
  const startedAt=performance.now();nativeBallAssist.progressText='Preparing video';
  state.observations=[contact];state.autoObservations=[];state.skippedVideoMarks=[];state.detectionAccepted=false;state.ballAssistAccepted=false;
  state.showAutoTrack=false;els.showAutoTrack.checked=false;
  goToWorkflowStep('ballPath');
  const showProgress=()=>{const label=document.getElementById('native-auto-progress');if(label)label.textContent=`${nativeBallAssist.progressText} · ${Math.floor((performance.now()-startedAt)/1000)}s`;};
  showProgress();const progressTimer=setInterval(showProgress,1000);
  const request=async(url,options={})=>{const response=await fetch('/api/ball-assist'+url,{...options,signal:controller.signal});const data=await response.json();if(!response.ok)throw Error(data.error||'Automatic detection is unavailable.');return data;};
  try{
    const identity=state.videoFile||els.video.currentSrc,sourceFps=1/currentStep();
    const raw=await prepareNativeSource(identity,controller.signal);
    let session=raw.streamed?raw:await request('/session/'+encodeURIComponent(raw.id)+'/contact',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({time:frameTime})});
    if(generation!==nativeBallAssist.generation)return;
    nativeBallAssist.progressText='Starting ball detection';showProgress();
    const frame=session.times.reduce((best,t,i)=>Math.abs(t-frameTime)<Math.abs(session.times[best]-frameTime)?i:best,0);
    const job=await request('/detect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:session.id,sampling:'dense',time:frameTime,source_fps:sourceFps,contact:{frame,x:contact.image_x*session.width/width,y:contact.image_y*session.height/height}})});
    if(generation!==nativeBallAssist.generation){fetch('/api/ball-assist/jobs/'+encodeURIComponent(job.id),{method:'DELETE'}).catch(()=>{});return;}
    nativeBallAssist.job=job.id;
    for(;;){
      await new Promise(resolve=>setTimeout(resolve,400));if(generation!==nativeBallAssist.generation)return;
      const status=await request('/jobs/'+encodeURIComponent(job.id));
      if(status.progress){const p=status.progress;nativeBallAssist.progressText=p.message||(p.completed>=p.total?'Checking detected path':`Detecting ${p.completed}/${p.total} frames (${Math.round(100*p.completed/p.total)}%)`);showProgress();}
      if(status.state==='failed'||status.state==='cancelled')throw Error(status.error||'Detection stopped.');
      if(status.state!=='done')continue;
      nativeBallAssist.job=null;
      if(status.result?.session)session={...session,...status.result.session};
      nativeBallAssist.points=(status.result?.points||[]).filter(p=>session.times[p.frame]>state.contactTime).map((p,index)=>({index:index+1,video_time_s:session.times[p.frame],relative_time_s:round(session.times[p.frame]-state.contactTime,6),image_x:p.x*width/session.width,image_y:p.y*height/session.height,reference_image_x:p.stabilized_x*width/session.width,reference_image_y:p.stabilized_y*height/session.height,reference_time_s:contactCalibrationTime(),background_alignment_reliable:p.background_alignment_reliable===true,uncertainty_px:6,timing_uncertainty_s:1/(2*(session.sourceFps||session.fps)),source:'COMPUTER_VISION',confidence:'MEDIUM',note:'Automatic detection reviewed by the user.'}));
      if(nativeBallAssist.points.some(p=>!Number.isFinite(p.reference_image_x)||!Number.isFinite(p.reference_image_y)))throw Error('Could not align the detected path to contact.');
      if(!nativeBallAssist.points.some(p=>p.relative_time_s>=.15))throw Error('Not enough ball flight was detected.');
      nativeBallAssist.phase='review';state.autoObservations=nativeBallAssist.points;state.showAutoTrack=true;els.showAutoTrack.checked=true;
      seekVideoTo(contactCalibrationTime()+.0001);renderWorkflowStep('ballPath');renderOverlay();return;
    }
  }catch(error){
    if(generation!==nativeBallAssist.generation)return;
    useRegularIntervalTagging();els.autoTrackStatus.textContent='Automatic tracking could not finish. Tag the ball manually.';
  }finally{clearInterval(progressTimer);}
}

function ballDetectionSeedReadiness() {
  if (!els.video.videoWidth) {
    return { ready: false, phase: "needs_video", message: "Load a video before tagging the ball path." };
  }
  if (state.contactTime === null) {
    return { ready: false, phase: "needs_contact_ball", message: "Use audio if helpful, then click the baseball at contact. That click sets contact and starts the path." };
  }
  if (state.ballAssistAccepted && state.detectionAccepted) {
    return {ready:true,phase:'accepted_auto_path',message:'Detected ball marks accepted. Choose "Continue to field marks".'};
  }
  const step = currentStep();
  const contactTolerance = Math.max(step * 0.65, 0.014);
  const fiveFrameTolerance = Math.max(step * 0.9, 0.018);
  const manual = manualBallObservations();
  const contactPoint = manual.find((obs) => (obs.role === "CONTACT_POINT" || Math.abs(Number(obs.video_time_s)-contactCalibrationTime()) <= contactTolerance));
  const skipped = state.skippedVideoMarks || [];
  if (!contactPoint && !skipped.includes("contact")) {
    return { ready: false, phase: "needs_contact_ball", markKey: "contact", message: 'Click the baseball at contact or choose "Not visible".' };
  }
  const scale = ballAnchorFrameGap() / 10;
  const fiveFramePoint = manual.find(obs => Number(obs.relative_time_s) > contactTolerance);
  const firstTime = adjacentFrameTime(ballAnchorFrameGap(),contactCalibrationTime()) - state.contactTime;
  const firstResolved = !!manual.find(obs => Math.abs(Number(obs.relative_time_s)-firstTime) <= fiveFrameTolerance)
    || skipped.includes("flight10");
  const ready = firstResolved;
  const duration = Number(els.video.duration) || Number(state.videoMetadata?.duration_s) || 60;
  let previousTime = contactCalibrationTime();
  for (let nominal = 10; nominal <= 10000; nominal += 5) {
    const gap = nominal * scale;
    if (contactCalibrationTime() + gap*step > duration + step*.5) break;
    const time = adjacentFrameTime(gap,contactCalibrationTime());
    if (time <= previousTime + step*.5) break;
    previousTime = time;
    const point = manual.find(obs => Math.abs(Number(obs.relative_time_s)-(time-state.contactTime)) <= fiveFrameTolerance);
    const key = `flight${nominal}`;
    if (!point && !skipped.includes(key)) return {
      ready, phase:nominal === 10 ? "needs_frame5_ball" : nominal === 15 ? "needs_later_ball" : nominal === 20 ? "needs_frame20_ball" : nominal === 25 ? "needs_frame25_ball" : "needs_more_ball",
      markKey:key, frameGap:gap, contactPoint, fiveFramePoint,
      message:`Mark the ball ${gap} frames after contact, or choose "Not visible".`,
    };
  }
  return {ready, phase:"end_of_video", contactPoint, fiveFramePoint,
    message:'No more frames in this video. Choose "Continue to field marks".'};
}

function syncDetectFlightButtons() {
  const readiness = ballDetectionSeedReadiness();
  return readiness;
}

function normalizeObservationRows(rows) {
  return rows
    .filter((row) => row.image_x !== null && row.image_y !== null)
    .map((row, index) => ({
      ...row,
      index: index + 1,
      video_time_s: row.video_time_s === null ? null : Number(row.video_time_s),
      relative_time_s: row.relative_time_s === null ? null : Number(row.relative_time_s),
      image_x: Number(row.image_x),
      image_y: Number(row.image_y),
      uncertainty_px: Number(row.uncertainty_px || 45),
      source: row.source || "COMPUTER_VISION",
      human_reviewed: row.human_reviewed === true,
      confidence: row.confidence || "LOW",
      note: row.note || "Detected ball-flight candidate.",
    }));
}

function normalizeLandmarkRows(rows) {
  return (rows || [])
    .filter((row) => row.image_x !== null && row.image_y !== null)
    .map((row, index) => ({
      index: index + 1,
      landmark: row.landmark,
      calibration_time_s: row.calibration_time_s === null ? null : Number(row.calibration_time_s),
      image_x: Number(row.image_x),
      image_y: Number(row.image_y),
      uncertainty_px: Number(row.uncertainty_px || 30),
      source: row.source || "HUMAN",
      confidence: row.confidence || "MEDIUM",
      note: row.note || "",
      estimate_kind: row.estimate_kind || null,
      rubber_visible: row.rubber_visible ?? null,
    }));
}

function loadPackageIntoState(packageData) {
  stopNativeBallAssist();
  state.ballAssistAccepted = false;
  const contact = packageData.hit?.contact;
  state.videoMetadata = { ...(packageData.video_metadata || {}) };
  state.skippedVideoMarks = [...(packageData.skipped_video_marks || [])];
  state.frameTimes = state.videoMetadata.frame_times_s || [];
  state.cameraChangedDuringMarks = packageData.camera?.changed_during_ball_marks === true;
  setFrameStepFromMetadata(state.videoMetadata);
  state.fileName = state.videoMetadata.file_name || state.fileName;
  state.contactTime = null;
  state.contactFrameTime = contact?.frame_timestamp_s ?? contact?.timestamp_s ?? null;
  state.contactTimingMode = contact?.timing_mode || "ON_FRAME";
  state.contactTimingChoice = state.contactTimingMode;
  state.contactUncertaintyS = contact?.uncertainty_s ?? currentStep()/2;
  if (contact?.timestamp_s !== undefined && contact?.timestamp_s !== null) {
    state.contactTime = Number(contact.timestamp_s);
  }

  const hit = packageData.hit || {};
  if (els.hitDescription) {
    els.hitDescription.value = String(hit.description || packageData.video_metadata?.description || "");
  }
  if (hit.gameframe_team_id || hit.gameframe_hitter_id) {
    renderGameFrameOptions({
      preferredTeamId: Number(hit.gameframe_team_id || 0),
      preferredHitterId: Number(hit.gameframe_hitter_id || 0),
    });
  }
  if (hit.direction_observation?.value) els.direction.value = hit.direction_observation.value;
  const fieldSizeKey = packageData.field?.key || packageData.field_size?.key || packageData.video_metadata?.field_size_key;
  if (fieldSizeKey && FIELD_PROFILES[fieldSizeKey] && els.fieldSize) {
    els.fieldSize.value = fieldSizeKey;
    updateFieldDiagram();
  }
  actualFieldMapState.distanceFt = null;
  actualFieldMapState.signedDirectionDeg = null;
  const restoredMapGeometry = hit.distance_observation?.actual_field_map
    || packageData.camera?.actual_field_map
    || null;
  actualFieldMapState.fieldGeometry = restoredMapGeometry;
  actualFieldMapState.evidenceImageDataUrl = restoredMapGeometry?.evidence_image_data_url || null;
  if (restoredMapGeometry?.landing_distance_ft !== undefined && restoredMapGeometry.landing_distance_ft !== null) {
    actualFieldMapState.distanceFt = Number(restoredMapGeometry.landing_distance_ft);
  }
  if (restoredMapGeometry?.landing_angle_deg !== undefined && restoredMapGeometry.landing_angle_deg !== null) {
    actualFieldMapState.signedDirectionDeg = Number(restoredMapGeometry.landing_angle_deg);
    if (els.direction) els.direction.value = directionValueFromSignedAngle(actualFieldMapState.signedDirectionDeg);
  }
  if (els.distanceFt) els.distanceFt.value = "";
  if (els.distanceUncertaintyFt) els.distanceUncertaintyFt.value = "";
  state.distanceCertainty = hit.distance_observation?.landing_certainty || 'guess';
  state.savedDistanceUncertaintyFt = hit.distance_observation?.uncertainty_ft || null;
  state.savedDistanceConfidence = hit.distance_observation?.confidence || null;
  state.apexEvent = null;
  if (els.distanceFt && hit.distance_observation?.distance_ft !== undefined && hit.distance_observation.distance_ft !== null) {
    els.distanceFt.value = String(hit.distance_observation.distance_ft);
  }
  if (els.distanceUncertaintyFt && hit.distance_observation?.uncertainty_ft !== undefined && hit.distance_observation.uncertainty_ft !== null) {
    els.distanceUncertaintyFt.value = String(hit.distance_observation.uncertainty_ft);
  }
  if (hit.apex_observation) {
    const apex = hit.apex_observation;
    if (apex.relative_time_s !== undefined && apex.relative_time_s !== null) {
      state.apexEvent = {
        relative_time_s: Number(apex.relative_time_s),
        video_time_s: state.contactTime === null ? null : round(state.contactTime + Number(apex.relative_time_s), 6),
        timing_uncertainty_s: Number(apex.time_uncertainty_s || apex.uncertainty_s || packageData.video_metadata?.frame_step_assumption_s || 0.033333),
        confidence: apex.confidence || "HIGH",
        source: apex.source || "HUMAN",
      };
    }
  }
  if (hit.distance_observation?.field_marker_percent) {
    setMarkerPosition(
      "landing",
      Number(hit.distance_observation.field_marker_percent.x ?? markers.landing.x),
      Number(hit.distance_observation.field_marker_percent.y ?? markers.landing.y),
    );
  }

  if (packageData.camera) {
    if (packageData.camera.vantage) els.cameraVantage.value = packageData.camera.vantage;
    if (packageData.camera.height_ft !== undefined && packageData.camera.height_ft !== null) {
      els.cameraHeightFt.value = String(packageData.camera.height_ft);
    }
    if (packageData.camera.field_marker_percent) {
      setMarkerPosition(
        "camera",
        Number(packageData.camera.field_marker_percent.x ?? markers.camera.x),
        Number(packageData.camera.field_marker_percent.y ?? markers.camera.y),
      );
    }
  }

  state.terminalEvent = packageData.terminal_event?.type === "FIRST_GROUND_CONTACT" ? packageData.terminal_event : null;
  const rows = normalizeObservationRows(packageData.ball_observations || []);
  state.observations = rows.map((row) => ({
    ...row,
    source: row.source || "HUMAN",
    confidence: row.confidence || "MEDIUM",
  }));
  state.landmarkUndoStack = [];
  state.landmarks = normalizeLandmarkRows(packageData.landmarks || []);
  state.pendingLandmarks = [];
  state.autoObservations = [];
  state.detectionAccepted = false;
  state.ballDetectionReadyAlerted = false;
  state.ballPathAudioStarted = false;
  state.showAutoTrack = els.showAutoTrack.checked;
  renderObservations();
  renderLandmarks();
  renderTerminalEvent();
  renderApexEvent();
  updateAutoTrackStatus();
  renderMetrics();
  renderOverlay();
  updateEstimateBanner();
  updateMenuAvailability();
  persistDraft("loaded");
}

function renderSavedHits() {
  renderEvLibrary();
}

async function loadSavedHits() {
  try {
    const response = await fetch("/api/gameframe/ev-hits", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load saved EV hits.");
    state.gameframe.savedHits = data.hits || [];
    state.gameframe.libraryLoaded = true;
    renderSavedHits();
  } catch (error) {
    if (els.evLibraryStatus) els.evLibraryStatus.textContent = `Library unavailable: ${error.message || error}`;
  }
}

function evLibraryCardTitle(hit) {
  return hit.description || hit.hitter_name || hit.source_file_name || `Saved hit #${hit.id}`;
}

function evLibrarySearchText(hit) {
  return [
    hit.description,
    hit.hitter_name,
    hit.team_name,
    hit.source_file_name,
    hit.best_exit_velocity_mph,
    hit.best_launch_angle_deg,
    hit.best_distance_ft,
    hit.created_at,
  ].map((value) => String(value ?? "").toLowerCase()).join(" ");
}

function visibleEvLibraryHits() {
  const query = String(els.evLibrarySearch?.value || "").trim().toLowerCase();
  const hits = state.gameframe.savedHits || [];
  return query ? hits.filter((hit) => evLibrarySearchText(hit).includes(query)) : hits;
}

function compactForLlm(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => compactForLlm(item, depth + 1));
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/blob|data_url|image_data_url|clip_blob/i.test(key)) {
      out[key] = "[omitted bulky binary/data-url field]";
    } else if (typeof entry === "string" && entry.length > 1800) {
      out[key] = `${entry.slice(0, 1800)}... [truncated ${entry.length} chars]`;
    } else if (depth > 10) {
      out[key] = "[omitted deeply nested field]";
    } else {
      out[key] = compactForLlm(entry, depth + 1);
    }
  }
  return out;
}

function metricLine(label, value, suffix = "") {
  const number = Number(value);
  if (!Number.isFinite(number)) return `${label}: not saved`;
  return `${label}: ${round(number, suffix === " s" ? 2 : 1)}${suffix}`;
}

function describeFullSavedHit(fullHit, summaryHit) {
  const pkg = fullHit.package || {};
  const prediction = fullHit.prediction || {};
  const observations = Array.isArray(pkg.ball_observations) ? pkg.ball_observations : [];
  const manualPoints = observations.filter((row) => String(row.source || "").toUpperCase() === "HUMAN");
  const cvPoints = observations.filter((row) => String(row.source || "").toUpperCase() === "COMPUTER_VISION");
  const landmarks = Array.isArray(pkg.landmarks) ? pkg.landmarks : [];
  const terminal = pkg.terminal_event || null;
  const distance = pkg.distance_observation || {};
  const best = practicalEstimate(prediction)
    || prediction?.practical_combined_estimate
    || prediction?.ev_candidates?.[0]
    || prediction?.unconstrained?.top?.[0]
    || {};
  const warnings = Array.isArray(prediction.evidence_warnings) ? prediction.evidence_warnings : [];
  const lines = [];
  lines.push(`## Saved Hit #${fullHit.id}`);
  lines.push(`Description: ${fullHit.description || summaryHit?.description || "(none)"}`);
  lines.push(`Source video: ${fullHit.source_file_name || summaryHit?.source_file_name || "(unknown)"}`);
  if (summaryHit?.hitter_name || summaryHit?.team_name) {
    lines.push(`Player/team: ${[summaryHit.hitter_name, summaryHit.team_name].filter(Boolean).join(" / ")}`);
  }
  lines.push(`Contact time: ${pkg.hit?.contact?.video_time_s ?? pkg.contact_time_s ?? "(not saved)"}`);
  lines.push(metricLine("Best EV", best.exit_velocity_mph ?? summaryHit?.best_exit_velocity_mph, " mph"));
  lines.push(metricLine("Best launch angle", best.launch_angle_deg ?? summaryHit?.best_launch_angle_deg, " deg"));
  lines.push(metricLine("Best distance", best.distance_ft ?? summaryHit?.best_distance_ft, " ft"));
  lines.push(metricLine("Best hang time", best.hang_time_s ?? summaryHit?.best_hang_time_s, " s"));
  lines.push(`Ball observations: ${observations.length} total; ${manualPoints.length} manual; ${cvPoints.length} computer vision.`);
  lines.push(`Field landmarks: ${landmarks.length}.`);
  lines.push(`Terminal/ground event: ${terminal ? JSON.stringify(compactForLlm(terminal)) : "not marked"}.`);
  lines.push(`Distance source: ${distance.source || "(not saved)"}; distance=${distance.distance_ft ?? "(none)"} ft; confidence=${distance.confidence || "(none)"}; uncertainty=${distance.uncertainty_ft ?? "(none)"} ft.`);
  if (prediction.synthetic_fit || best.synthetic_score !== undefined || best.pixel_rmse !== undefined) {
    lines.push(`Synthetic fit summary: score=${best.synthetic_score ?? prediction.synthetic_fit?.score ?? "(none)"}, pixel/path error=${best.pixel_rmse ?? prediction.synthetic_fit?.path_error_px ?? "(none)"}, hit_id=${best.hit_id || "(none)"}.`);
  }
  if (warnings.length) {
    lines.push(`Evidence warnings: ${warnings.map((warning) => warning.message || warning.reason || JSON.stringify(warning)).join(" | ")}`);
  }
  lines.push("Collected observation package JSON, with bulky media/data URLs omitted:");
  lines.push(JSON.stringify(compactForLlm(pkg), null, 2));
  lines.push("Prediction JSON, with bulky media/data URLs omitted:");
  lines.push(JSON.stringify(compactForLlm(prediction), null, 2));
  return lines.join("\n");
}

async function loadFullSavedHit(hitId) {
  const response = await fetch(`/api/gameframe/ev-hit?id=${encodeURIComponent(hitId)}`, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Could not load saved EV hit #${hitId}.`);
  return data;
}

async function openHitOverviewModal(hitId) {
  const summary = (state.gameframe.savedHits || []).find((hit) => String(hit.id) === String(hitId));
  if (els.libraryOverviewStatus) els.libraryOverviewStatus.textContent = `Loading full data for saved hit #${hitId}...`;
  if (els.libraryOverviewText) els.libraryOverviewText.value = "Loading saved hit data...";
  if (els.libraryOverviewModal && typeof els.libraryOverviewModal.showModal === "function" && !els.libraryOverviewModal.open) {
    els.libraryOverviewModal.showModal();
  }
  const fullHit = await loadFullSavedHit(hitId);
  const now = new Date().toISOString();
  const overview = [
    `# GameFrame EV Modeling Hit Data Overview - Saved Hit #${hitId}`,
    "",
    "Purpose: This app estimates baseball batted-ball metrics from ordinary video. The user marks contact timing, early ball positions, field/camera landmarks, and/or a real field-map landing point. The app compares the observed video geometry and early ball path against synthetic trajectory candidates to estimate exit velocity, launch angle, distance, hang time, and confidence. The goal of this export is to let another LLM inspect whether the collected evidence, assumptions, synthetic matching, and final estimates appear internally consistent.",
    "",
    "Important interpretation notes:",
    "- Ball observations contain image-space x/y points and relative timing after contact. HUMAN points are user-marked; COMPUTER_VISION points are detector-generated or line-scan generated.",
    "- Field landmarks and actual-field-map geometry provide real-world scale, camera direction, landing distance, and spray direction.",
    "- Prediction JSON may include candidate rows, synthetic fit scores, path error, distance confidence, launch-angle source, and warning/blocker text.",
    "- Bulky media blobs, clips, screenshots, and data URLs are intentionally omitted from this text.",
    "",
    `Generated: ${now}`,
    "Scope: one saved hit only.",
    "",
    describeFullSavedHit(fullHit, summary),
  ].join("\n\n");
  if (els.libraryOverviewText) {
    els.libraryOverviewText.value = overview;
    els.libraryOverviewText.focus();
    els.libraryOverviewText.select();
  }
  if (els.libraryOverviewStatus) els.libraryOverviewStatus.textContent = `Saved hit #${hitId} summarized.`;
}

function updateEvLibrarySelectionControls() {
  const selectedCount = state.gameframe.selectedEvHitIds.size;
  if (els.evLibraryDeleteSelected) {
    els.evLibraryDeleteSelected.disabled = selectedCount === 0;
    els.evLibraryDeleteSelected.textContent = selectedCount ? `Delete Selected (${selectedCount})` : "Delete Selected";
  }
}

function renderEvLibrary() {
  if (!els.evLibraryList) return;
  const allHits = state.gameframe.savedHits || [];
  const hits = visibleEvLibraryHits();
  if (els.evLibraryStatus) {
    els.evLibraryStatus.textContent = state.gameframe.libraryNotice || (allHits.length
      ? `${hits.length} of ${allHits.length} saved EV hit${allHits.length === 1 ? "" : "s"} shown.`
      : "No saved EV hits yet.");
    state.gameframe.libraryNotice = "";
  }
  els.evLibraryList.innerHTML = hits.length
    ? hits.map((hit) => {
        const metrics = [
          Number.isFinite(Number(hit.best_exit_velocity_mph)) ? `${Number(hit.best_exit_velocity_mph).toFixed(0)} mph` : null,
          Number.isFinite(Number(hit.best_launch_angle_deg)) ? `${Number(hit.best_launch_angle_deg).toFixed(0)} degrees` : null,
          Number.isFinite(Number(hit.best_distance_ft)) ? `${Number(hit.best_distance_ft).toFixed(0)} feet` : null,
        ].filter(Boolean).join(" / ");
        const player = [hit.hitter_name, hit.team_name].filter(Boolean).join(" - ");
        const clipUrl = `/api/gameframe/ev-clip?id=${encodeURIComponent(hit.id)}&kind=generated&inline=1`;
        const downloadUrl = `/api/gameframe/ev-clip?id=${encodeURIComponent(hit.id)}&kind=generated`;
        const hasGeneratedClip = Boolean(hit.has_generated_clip);
        const hitId = String(hit.id);
        const checked = state.gameframe.selectedEvHitIds.has(hitId) ? " checked" : "";
        return `
          <article class="ev-library-card" data-hit-id="${escapeHtml(hitId)}">
            <label class="ev-library-select">
              <input type="checkbox" data-library-select="${escapeHtml(hitId)}"${checked} />
            </label>
            ${hasGeneratedClip
              ? `<a class="ev-library-thumb" href="${clipUrl}" target="_blank" rel="noopener" aria-label="Play generated EV video">
                  <video src="${clipUrl}#t=0.1" muted playsinline preload="metadata"></video>
                </a>`
              : `<div class="ev-library-thumb ev-library-thumb-missing">Generated clip missing</div>`}
            <div class="ev-library-card-main">
              <strong>${escapeHtml(evLibraryCardTitle(hit))}</strong>
              <span>${escapeHtml(player || "No hitter selected")}</span>
              <span>${escapeHtml(metrics || "No estimate saved")}</span>
              ${hasGeneratedClip ? `<span>Video stored locally in the GameFrame database.</span>` : `<span class="library-warning">This entry was saved without a generated overlay clip.</span>`}
              <span>${escapeHtml(hit.created_at ? `Saved ${hit.created_at}` : "")}</span>
            </div>
            <div class="ev-library-actions">
              ${hasGeneratedClip
                ? `<a class="ev-library-action" href="${clipUrl}" target="_blank" rel="noopener">Play Video</a>`
                : `<button type="button" disabled>Play Video</button>`}
              ${hasGeneratedClip
                ? `<a class="ev-library-action" href="${downloadUrl}">Download Video</a>`
                : `<button type="button" disabled>Download Video</button>`}
              <button type="button" data-library-action="overview" data-hit-id="${escapeHtml(String(hit.id))}">Data Overview</button>
              <button type="button" data-library-action="map" data-hit-id="${escapeHtml(String(hit.id))}">Compare on map</button>
              <button type="button" data-library-action="description" data-hit-id="${escapeHtml(String(hit.id))}">Edit Video Description</button>
              <button type="button" data-library-action="setup" data-hit-id="${escapeHtml(String(hit.id))}">Edit Video Setup</button>
              <button type="button" class="danger" data-library-action="delete" data-hit-id="${escapeHtml(String(hit.id))}">Delete</button>
            </div>
          </article>
        `;
      }).join("")
    : `<div class="ev-library-empty">${allHits.length ? "No EV hits match that search." : "No saved EV hits yet."}</div>`;
  updateEvLibrarySelectionControls();
}

async function updateSavedEvDescription(hitId) {
  const hit = (state.gameframe.savedHits || []).find((entry) => Number(entry.id) === Number(hitId));
  if (!hit) return;
  const description = prompt("Video description", hit.description || "");
  if (description === null) return;
  const response = await fetch("/api/gameframe/ev-hit/description", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: hitId, description }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not update description.");
  hit.description = data.description || description;
  renderSavedHits();
}

async function deleteSavedEvHit(hitId) {
  if (!confirm("Delete this saved EV hit?")) return;
  await deleteSavedEvHitById(hitId);
  state.gameframe.savedHits = (state.gameframe.savedHits || []).filter((hit) => Number(hit.id) !== Number(hitId));
  state.gameframe.selectedEvHitIds.delete(String(hitId));
  renderSavedHits();
}

async function deleteSavedEvHitById(hitId) {
  const response = await fetch("/api/gameframe/ev-hit/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: hitId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not delete saved hit.");
}

async function deleteSelectedEvHits() {
  const ids = Array.from(state.gameframe.selectedEvHitIds);
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} selected EV hit${ids.length === 1 ? "" : "s"}?`)) return;
  if (els.evLibraryDeleteSelected) {
    els.evLibraryDeleteSelected.disabled = true;
    els.evLibraryDeleteSelected.textContent = "Deleting...";
  }
  for (const id of ids) {
    await deleteSavedEvHitById(id);
  }
  const deleted = new Set(ids.map(String));
  state.gameframe.savedHits = (state.gameframe.savedHits || []).filter((hit) => !deleted.has(String(hit.id)));
  state.gameframe.selectedEvHitIds.clear();
  renderSavedHits();
}

function showEvLibrary() {
  if (!els.evLibraryPanel) return;
  if (!state.gameframe.libraryLoaded) void loadSavedHits();
  els.viewerPanel.hidden = true;
  els.evLibraryPanel.hidden = false;
  renderEvLibrary();
}

function showVideoWorkspace() {
  if (!els.evLibraryPanel) return;
  els.evLibraryPanel.hidden = true;
  els.viewerPanel.hidden = false;
  requestAnimationFrame(syncCanvasSize);
}

async function loadSavedEvHitFromDatabase(hitId) {
  const response = await fetch(`/api/gameframe/ev-hit?id=${encodeURIComponent(hitId)}`, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load saved EV hit.");
  await loadGameFrameOptions();
  if (state.videoObjectUrl) {
    URL.revokeObjectURL(state.videoObjectUrl);
    state.videoObjectUrl = null;
  }
  state.videoFile = null;
  state.fileName = data.source_file_name || `ev-hit-${hitId}.mp4`;
  if (data.source_clip_url) {
    els.video.src = data.source_clip_url;
    els.video.load();
  }
  loadPackageIntoState(data.package || {});
  if (data.source_video_path) {
    state.videoMetadata = {
      ...state.videoMetadata,
      source_path: data.source_video_path,
    };
  }
  const withdrawnDescentPrediction=usesDescentRate(data.prediction);
  state.latestPrediction = withdrawnDescentPrediction ? null : data.prediction || null;
  if(withdrawnDescentPrediction){
    els.predictionStatus.textContent='Saved marks loaded; recalculate with restored timing-only estimation.';
    els.predictionUnconstrained.textContent='Recalculate this hit using the existing marks.';
    els.showFlightView.disabled=true;state.flightView.visible=false;
    renderEvidenceWarnings(null);renderFlightView();
  }
  if (state.latestPrediction) {
    renderDirectPredictionCard(els.predictionUnconstrained, state.latestPrediction);
    renderEvidenceWarnings(state.latestPrediction);
    els.showFlightView.disabled = !bestPredictionRow();
    state.flightView.visible = Boolean(bestPredictionRow());
    if (state.flightView.visible) {
      els.resetFlightView.hidden = false;
      setFlightPreset("video");
      renderFlightView();
    }
    els.predictionStatus.textContent = `loaded saved estimate #${hitId}`;
  }
  updateEstimateBanner();
  updateMenuAvailability();
  setMenuOpen(true);
  els.autoTrackStatus.textContent = `Loaded saved EV hit #${hitId} from library.`;
}

function setMenuOpen(open) {
  if (els.menuScrim) els.menuScrim.hidden = true;
  requestAnimationFrame(syncCanvasSize);
}

function updateMenuAvailability() {
  const hasVideoSource = Boolean(state.videoFile || els.video.getAttribute("src"));
  const hasLoadedHit = hasVideoSource;
  [els.loadPrediction, els.downloadClip, els.downloadJson, els.openWorkflow].forEach((element) => {
    if (element) element.disabled = !hasLoadedHit;
  });
  els.loadedOnlySections.forEach((section) => {
    section.hidden = !hasLoadedHit;
  });
}

function reindexRows(rows) {
  rows.forEach((row, index) => {
    row.index = index + 1;
  });
}

function observationFrameKey(obs) {
  const rel = Number(obs?.relative_time_s);
  const step = Math.max(currentStep(), 1 / 240);
  return Number.isFinite(rel) ? String(Math.round(rel / step)) : null;
}

function isManualBallObservation(obs) {
  return String(obs?.source || "").toUpperCase() === "HUMAN";
}

function markerDistanceToClick(marker, clickVideoPoint) {
  const markerDisplay = videoToDisplayPoint(marker.x, marker.y);
  const clickDisplay = videoToDisplayPoint(clickVideoPoint.x, clickVideoPoint.y);
  return Math.hypot(markerDisplay.x - clickDisplay.x, markerDisplay.y - clickDisplay.y);
}

function eraseNearestMarker(clickVideoPoint) {
  const candidates = [];

  for (const obs of observationsErasableAtCurrentTime()) {
    candidates.push({
      kind: "observation",
      index: state.observations.indexOf(obs),
      x: obs.image_x,
      y: obs.image_y,
    });
  }

  if (state.showAutoTrack) {
    for (const obs of autoObservationsErasableAtCurrentTime()) {
      candidates.push({
        kind: "auto",
        index: state.autoObservations.indexOf(obs),
        x: obs.image_x,
        y: obs.image_y,
      });
    }
  }

  for (const landmark of state.landmarks) {
    candidates.push({
      kind: "landmark",
      index: state.landmarks.indexOf(landmark),
      x: landmark.image_x,
      y: landmark.image_y,
    });
  }

  const terminalVisible =
    state.terminalEvent !== null
    && state.terminalEvent.image_x !== null
    && state.terminalEvent.video_time_s !== null
    && state.terminalEvent.video_time_s <= (els.video.currentTime || 0) + Math.max(currentStep() * 0.55, 0.01);
  if (terminalVisible) {
    candidates.push({
      kind: "terminal",
      index: 0,
      x: state.terminalEvent.image_x,
      y: state.terminalEvent.image_y,
    });
  }

  let nearest = null;
  for (const candidate of candidates) {
    const distance = markerDistanceToClick(candidate, clickVideoPoint);
    if (!nearest || distance < nearest.distance) nearest = { ...candidate, distance };
  }
  if (!nearest || nearest.distance > 34) return false;

  let label = "mark";

  if (nearest.kind === "observation") {
    state.observations.splice(nearest.index, 1);
    reindexRows(state.observations);
    renderObservations();
    label = "ball point";
  } else if (nearest.kind === "auto") {
    state.autoObservations.splice(nearest.index, 1);
    reindexRows(state.autoObservations);
    updateAutoTrackStatus();
    label = "detected point";
  } else if (nearest.kind === "landmark") {
    state.landmarks.splice(nearest.index, 1);
    reindexRows(state.landmarks);
    renderLandmarks();
    label = "landmark";
  } else if (nearest.kind === "terminal") {
    state.terminalEvent = null;
    renderTerminalEvent();
    label = "ground contact";
  }
  els.autoTrackStatus.textContent = `Erased ${label}.`;
  renderOverlay();
  persistDraft();
  return true;
}

function waitForVideoSeek(time) {
  return new Promise((resolve, reject) => {
    const target = Math.max(0, Math.min(time, els.video.duration || time));
    if (Math.abs((els.video.currentTime || 0) - target) < 0.001) {
      resolve();
      return;
    }
    const cleanup = () => {
      els.video.removeEventListener("seeked", onSeeked);
      els.video.removeEventListener("error", onError);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Video seek failed."));
    };
    els.video.addEventListener("seeked", onSeeked, { once: true });
    els.video.addEventListener("error", onError, { once: true });
    els.video.currentTime = target;
  });
}

function ballAnchorFrameGap() {
  return Math.round(1 / currentStep()) >= 50 ? 20 : 10;
}

function laterBallAnchorFrameGap() {
  return Math.round(1 / currentStep()) >= 50 ? 30 : 15;
}

function lastBallAnchorFrameGap() {
  return Math.round(1 / currentStep()) >= 50 ? 40 : 20;
}

function extraBallAnchorFrameGap() {
  return Math.round(1 / currentStep()) >= 50 ? 50 : 25;
}

function acceptAutoTrack() {
  if (state.autoObservations.length === 0) return;
  markPredictionStale();
  const manualByFrame = new Map();
  for (const obs of state.observations) {
    if (!isManualBallObservation(obs)) continue;
    const key = observationFrameKey(obs);
    if (key !== null) manualByFrame.set(key, obs);
  }
  const usedManualFrames = new Set();
  const merged = state.autoObservations.map((obs) => {
    const key = observationFrameKey(obs);
    const manual = key === null ? null : manualByFrame.get(key);
    if (manual) {
      usedManualFrames.add(key);
      return {
        ...manual,
        source: "HUMAN",
        note: manual.note || "Manual ball point kept over detected point for this frame.",
      };
    }
    return {
      ...obs,
      human_reviewed: true,
      note: obs.note || "Accepted automatic ball-flight detection.",
    };
  });
  for (const [key, manual] of manualByFrame.entries()) {
    if (!usedManualFrames.has(key)) merged.push(manual);
  }
  merged.sort((a, b) => Number(a.relative_time_s || 0) - Number(b.relative_time_s || 0));
  reindexRows(merged);
  state.observations = merged;
  state.detectionAccepted = true;
  renderObservations();
  renderOverlay();
  els.autoTrackStatus.textContent = "Detection accepted.";
  persistDraft();
  // The wizard waits for player details and explicit Continue before prediction.
  if (!els.setupModal?.open) startBackgroundPrediction("detected path accepted");
}

function clearAutoTrack() {
  state.autoObservations = [];
  state.detectionAccepted = false;
  updateAutoTrackStatus();
  renderOverlay();
  persistDraft();
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function scoreAudioWindows(samples, sampleRate, windowMs = 8) {
  const windowSize = Math.max(64, Math.round((sampleRate * windowMs) / 1000));
  const hop = Math.max(16, Math.round(windowSize / 4));
  const rows = [];
  let prevRms = 1e-6;
  for (let start = 0; start + windowSize < samples.length; start += hop) {
    let sumSq = 0;
    let peak = 0;
    let crack = 0;
    for (let i = start; i < start + windowSize; i += 1) {
      const sample = samples[i];
      const abs = Math.abs(sample);
      sumSq += sample * sample;
      if (abs > peak) peak = abs;
      if (i > start) {
        const delta = Math.abs(samples[i] - samples[i - 1]);
        if (delta > crack) crack = delta;
      }
    }
    const rms = Math.sqrt(sumSq / windowSize);
    const rise = rms / Math.max(prevRms, 1e-6);
    rows.push({
      time_s: start / sampleRate,
      peak,
      crack,
      rms,
      score: peak * 1.4 + crack * 2.2 + Math.min(rise, 8) * 0.08,
    });
    prevRms = Math.max(rms, 1e-6);
  }
  return rows;
}

function contactCalibrationTime() {
  return state.contactTime === null ? null : state.contactFrameTime ?? state.contactTime;
}

function setContactFromDisplayedFrame() {
  const frameTime = displayedFrameTime();
  const mode = state.contactTimingChoice || state.contactTimingMode || "ON_FRAME";
  if (mode === "BETWEEN_FRAMES" && frameTime <= 0) {
    setWorkflowVideoPrompt("There is no previous frame here. Move forward to the first frame after contact.");
    return false;
  }
  setContactTime(mode === "BETWEEN_FRAMES" ? (frameTime+adjacentFrameTime(-1,frameTime))/2 : frameTime, {frameTime,mode});
  return true;
}

function setContactTime(time, {frameTime=time, mode="ON_FRAME"} = {}) {
  stopNativeBallAssist();
  state.ballAssistAccepted = false;
  markPredictionStale();
  state.detectionAccepted = false;
  state.ballDetectionReadyAlerted = false;
  state.ballPathAudioStarted = false;
  state.contactTime = Math.max(0, time);
  state.contactFrameTime = frameTime;
  state.contactTimingMode = mode;
  state.contactTimingChoice = mode;
  state.contactUncertaintyS = frameIntervalAt(frameTime)/2;
  if (state.terminalEvent) {
    state.terminalEvent.relative_time_s = round(state.terminalEvent.video_time_s-state.contactTime,6);
    state.terminalEvent.contact_uncertainty_s = state.contactUncertaintyS;
    state.terminalEvent.timing_uncertainty_s = round((state.terminalEvent.landing_time_uncertainty_s ?? currentStep()) + state.contactUncertaintyS,6);
  }
  for (const obs of state.observations) {
    obs.relative_time_s = round(obs.video_time_s - state.contactTime, 6);
  }
  if (state.apexEvent?.video_time_s !== null && state.apexEvent?.video_time_s !== undefined) {
    state.apexEvent.relative_time_s = round(state.apexEvent.video_time_s - state.contactTime, 6);
  }
  renderMetrics();
  renderObservations();
  renderApexEvent();
  persistDraft();
  scheduleContactPreload();
}

let selectedAudioAnalysis = null;
function analyzeSelectedVideoAudio(file) {
  if(selectedAudioAnalysis?.file===file)return selectedAudioAnalysis.promise;
  const entry={file,promise:null};selectedAudioAnalysis=entry;
  entry.promise=(async()=>{
    const AudioContextClass=window.AudioContext||window.webkitAudioContext;
    if(!AudioContextClass)throw Error('Web Audio is not available in this browser.');
    const context=new AudioContextClass();
    try{
      const buffer=await context.decodeAudioData(await file.arrayBuffer());
      const rows=scoreAudioWindows(buffer.getChannelData(0),buffer.sampleRate),scores=rows.map(row=>row.score);
      if(!scores.some(score=>score>0))throw Error('No audible contact found');
      const base=median(scores),mad=median(scores.map(score=>Math.abs(score-base)))||1e-6;
      const loudest=rows.reduce((winner,row)=>row.score>winner.score?row:winner,rows[0]);
      const threshold=Math.max(base+3*1.4826*mad,loudest.score*.35);
      const best=rows.find(row=>row.time_s>=.15&&row.score>=threshold)||loudest;
      const z=(best.score-base)/(1.4826*mad);
      return {time:best.time_s,confidence:z>=12?'HIGH':z>=7?'MEDIUM':'LOW'};
    }finally{await context.close().catch(()=>{});}
  })();return entry.promise;
}
function audioContactProposal(analysis){
  // Keep the existing audible-contact correction. The ten-frame safety margin
  // belongs only to preloading and never changes the proposed or tagged contact.
  const leadFrames=Number(els.contactAudioLeadFrames.value||0)+1;
  return {...analysis,leadFrames,time:Math.max(0,analysis.time-leadFrames*currentStep()),noiseTime:analysis.time};
}
let selectionPreparation=null;
function showSelectionPreparation(message){
  const label=document.getElementById('video-preparation-status');if(label)label.textContent=message;
}
async function startSelectionPreparation(file){
  selectionPreparation?.controller.abort();
  const entry={file,controller:new AbortController(),status:'audio',candidate:null,session:null};selectionPreparation=entry;
  showSelectionPreparation('Finding likely contact in the background…');
  void (async()=>{
    for(let i=0;i<200&&els.video.readyState<1;i++){
      if(entry.controller.signal.aborted||file!==state.videoFile)return;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    if(file===state.videoFile&&entry===selectionPreparation&&els.video.videoWidth)await prepareNativeSource(file,entry.controller.signal);
  })().catch(()=>{});
  try{
    let analysis=null;try{analysis=await analyzeSelectedVideoAudio(file);}catch(_){}
    if(file!==state.videoFile||entry!==selectionPreparation)return;
    for(let i=0;i<100&&(els.video.readyState<1||state.videoTimingBusy);i++)await new Promise(resolve=>setTimeout(resolve,50));
    await refreshVideoTiming(contactCalibrationTime() ?? analysis?.time ?? 0);
    if(file!==state.videoFile||entry!==selectionPreparation)return;
    if(state.contactTime!==null){entry.status='confirmed';showSelectionPreparation('Using your confirmed contact frame.');return;}
    if(!analysis){entry.status='waiting-contact';showSelectionPreparation('Video ready. Mark contact when prompted.');return;}
    const proposal=audioContactProposal(analysis);
    const fps=1/currentStep(),candidate=proposal?displayedFrameTime(proposal.time):null;
    entry.candidate=candidate;entry.status='source';
    const session=await prepareNativeSource(file,entry.controller.signal);
    if(file!==state.videoFile||entry!==selectionPreparation)return;
    entry.session=session;entry.status='ready';
    if(candidate!==null)fetch('/api/gameframe/preload-contact',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({preload_time_s:contactCalibrationTime()??candidate,package:buildPackage()})}).catch(()=>{});
    showSelectionPreparation('Video prepared. Check contact when prompted.');
  }catch(error){if(entry!==selectionPreparation||entry.controller.signal.aborted)return;entry.status='unavailable';showSelectionPreparation('You can continue; frames will load when contact is marked.');}
}

async function detectContactFromAudio({auto = false} = {}) {
  const sourceFile = state.videoFile;
  const startingTime = els.video.currentTime;
  if (!state.videoFile) {
    els.contactAudioStatus.textContent = "Load a video first.";
    return;
  }
  els.contactAudioStatus.textContent = "Scanning audio...";
  try {
    const proposal=audioContactProposal(await analyzeSelectedVideoAudio(sourceFile));
    const proposedContact=proposal.time,confidence=proposal.confidence,leadFrames=proposal.leadFrames;
    if (auto && (sourceFile !== state.videoFile || state.contactTime !== null || activeWorkflowStep !== "contact" ||
        Math.abs(els.video.currentTime-startingTime) > currentStep()*.55)) return;
    await waitForVideoSeek(proposedContact);
    if (sourceFile !== state.videoFile) return;
    els.contactAudioStatus.textContent =
      `Audio jumped to likely contact at ${round(proposedContact, 3).toFixed(3)} s (${confidence}, first loud noise ${round(proposal.noiseTime, 3).toFixed(3)} s, lead ${leadFrames} frames). Click the ball here to set contact.`;
    if (confidence === "HIGH") els.contactConfidence.value = "HIGH";
    else if (confidence === "MEDIUM") els.contactConfidence.value = "MEDIUM";
    else els.contactConfidence.value = "LOW";
    renderMetrics();
    renderOverlay();
  } catch (error) {
    els.contactAudioStatus.textContent = `Audio detection failed: ${error.message || error}`;
  }
}

function addObservation({ x = null, y = null, note = "" }) {
  const restoredKeys = [
    ["contact", contactCalibrationTime()],
    ["flight10", adjacentFrameTime(ballAnchorFrameGap(),contactCalibrationTime())],
    ["flight15", adjacentFrameTime(laterBallAnchorFrameGap(),contactCalibrationTime())],
    ["flight20", adjacentFrameTime(lastBallAnchorFrameGap(),contactCalibrationTime())],
    ["flight25", adjacentFrameTime(extraBallAnchorFrameGap(),contactCalibrationTime())],
  ].filter(([,time]) => Math.abs(Number(els.video.currentTime)-time) <= currentStep()*.9).map(([key])=>key);
  const elapsedFrames = Math.round((Number(els.video.currentTime)-contactCalibrationTime())/currentStep());
  const nominal = Math.round(elapsedFrames/(ballAnchorFrameGap()/10));
  if (nominal >= 10 && nominal % 5 === 0) restoredKeys.push(`flight${nominal}`);
  state.skippedVideoMarks = (state.skippedVideoMarks || []).filter(key => !restoredKeys.includes(key));
  const videoTime = displayedFrameTime();
  const isContactBallPoint = x !== null && y !== null && state.contactTime === null;
  if (isContactBallPoint) {
    setContactTime(videoTime);
  }
  markPredictionStale();
  state.detectionAccepted = false;
  state.ballDetectionReadyAlerted = false;
  const cleanNote = note || (isContactBallPoint ? "Contact ball point." : "");
  const nextObservation = {
    index: state.observations.length + 1,
    video_time_s: round(videoTime, 6),
    relative_time_s: round(relativeTime(videoTime), 6),
    image_x: x === null ? null : round(x, 2),
    image_y: y === null ? null : round(y, 2),
    uncertainty_px: x === null ? null : Number(els.uncertainty.value || 30),
    source: els.pointSource.value,
    confidence: els.pointConfidence.value,
    human_reviewed: true,
    role: isContactBallPoint ? "CONTACT_POINT" : undefined,
    note: cleanNote,
  };
  const nextFrameKey = observationFrameKey(nextObservation);
  const existingManual = state.observations.find(
    (obs) => isManualBallObservation(obs) && observationFrameKey(obs) === nextFrameKey,
  );
  if (existingManual) {
    Object.assign(existingManual, {
      ...nextObservation,
      index: existingManual.index,
      role: nextObservation.role ?? existingManual.role,
      note: note || existingManual.note || "Manual ball point adjusted for this frame.",
    });
    nextObservation.index = existingManual.index;
  } else {
    state.observations.push(nextObservation);
  }
  reindexRows(state.observations);
  renderObservations();
  renderOverlay();
  persistDraft();
  return existingManual || nextObservation;
}

function undoLastObservation() {
  markPredictionStale();
  state.detectionAccepted = false;
  state.ballDetectionReadyAlerted = false;
  const removed = state.observations.pop();
  if (removed?.role === "CONTACT_POINT" || state.observations.length === 0) {
    state.contactTime = null;
    state.apexEvent = null;
    for (const obs of state.observations) obs.relative_time_s = null;
  }
  reindexRows(state.observations);
  renderMetrics();
  renderObservations();
  renderApexEvent();
  renderOverlay();
  persistDraft();
}

function clearManualBallPathPoints() {
  markPredictionStale();
  state.detectionAccepted = false;
  state.ballDetectionReadyAlerted = false;
  state.observations = state.observations.filter((obs) => !isManualBallObservation(obs));
  state.contactTime = null;
  state.apexEvent = null;
  for (const obs of state.observations) obs.relative_time_s = null;
  reindexRows(state.observations);
  renderMetrics();
  renderObservations();
  renderApexEvent();
  renderOverlay();
  updateAutoTrackStatus();
  persistDraft();
}

function renderObservations() {
  els.observationsBody.innerHTML = "";
  for (const obs of state.observations) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${obs.index}</td>
      <td>${obs.video_time_s.toFixed(6)}</td>
      <td>${obs.relative_time_s === null ? "" : obs.relative_time_s.toFixed(6)}</td>
      <td>${obs.image_x ?? ""}</td>
      <td>${obs.image_y ?? ""}</td>
      <td>${obs.uncertainty_px ?? ""}</td>
      <td>${obs.source}</td>
      <td>${obs.confidence}</td>
      <td>${escapeHtml(obs.note || "")}</td>
    `;
    els.observationsBody.appendChild(row);
  }
  els.observationCount.textContent = `${state.observations.length} rows`;
}

function addLandmark({ x, y }) {
  if (activeWorkflowStep === "landmarks" && (state.contactTime === null || els.video.seeking || Math.abs(els.video.currentTime - contactCalibrationTime()) > currentStep() * .55)) {
    if (state.contactTime === null) goToWorkflowStep("contact");
    else {
      seekVideoTo(contactCalibrationTime());
      setWorkflowVideoPrompt("Field marks must be tagged on the contact frame. Wait for it, then click again.");
    }
    return false;
  }
  (state.landmarkUndoStack ||= []).push(state.landmarks.map(row => ({...row})));
  markPredictionStale();
  const currentLandmark = els.landmarkType.value;
  // A manual correction wins over the corresponding unconfirmed suggestion.
  state.pendingLandmarks = state.pendingLandmarks.filter(row => row.landmark !== currentLandmark);
  state.skippedVideoMarks = (state.skippedVideoMarks || []).filter(key => key !== `field:${currentLandmark}`);
  state.landmarks = state.landmarks.filter(row => row.landmark !== currentLandmark);
  state.landmarks.push({
    index: state.landmarks.length + 1,
    landmark: currentLandmark,
    calibration_time_s: round(els.video.currentTime || 0, 6),
    image_x: round(x, 2),
    image_y: round(y, 2),
    uncertainty_px: Number(els.uncertainty.value || 30),
    source: els.pointSource.value,
    confidence: els.pointConfidence.value,
    human_reviewed: true,
  });
  renderLandmarks();
  renderOverlay();
  if (!workflowLandmarkReview) advanceLandmarkType(currentLandmark);
  persistDraft();
}

function undoFieldLandmark() {
  cancelWorkflowPrediction();
  markPredictionStale();
  const last = state.landmarks.at(-1);
  const previous = state.landmarkUndoStack?.pop();
  state.landmarks = previous ?? state.landmarks.slice(0, -1);
  reindexRows(state.landmarks);
  if (last) els.landmarkType.value = last.landmark;
  renderLandmarks();
  renderOverlay();
  persistDraft();
  if (els.setupModal?.open) renderWorkflowStep("landmarks");
}

function advanceLandmarkType(currentLandmark) {
  const currentIndex = LANDMARK_SEQUENCE.indexOf(currentLandmark);
  const used = new Set(state.landmarks.map((row) => row.landmark));
  const remaining = LANDMARK_SEQUENCE.slice(Math.max(0, currentIndex + 1)).find((landmark) => !used.has(landmark))
    || LANDMARK_SEQUENCE.find((landmark) => !used.has(landmark));
  if (remaining && Array.from(els.landmarkType.options).some((option) => option.value === remaining)) {
    els.landmarkType.value = remaining;
  }
}

function renderLandmarks() {
  els.landmarksBody.innerHTML = "";
  for (const landmark of state.landmarks) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${landmark.index}</td>
      <td>${escapeHtml(landmark.landmark)}</td>
      <td>${landmark.image_x}</td>
      <td>${landmark.image_y}</td>
      <td>${landmark.uncertainty_px}</td>
      <td>${landmark.source}</td>
      <td>${landmark.confidence}</td>
      <td>${escapeHtml(landmark.note || "")}</td>
    `;
    els.landmarksBody.appendChild(row);
  }
  els.landmarkCount.textContent = `${state.landmarks.length} rows`;
}

function stageSuggestedLandmarks(rows) {
  state.pendingLandmarks = [];
  let added = 0;
  for (const row of rows || []) {
    if (row.image_x === null || row.image_y === null || !row.landmark) continue;
    const duplicate = state.pendingLandmarks.some(existing => existing.landmark === row.landmark);
    if (duplicate) continue;
    state.pendingLandmarks.push({
      index: state.pendingLandmarks.length + 1,
      landmark: row.landmark,
      calibration_time_s: round(contactCalibrationTime(), 6),
      image_x: round(row.image_x, 2),
      image_y: round(row.image_y, 2),
      uncertainty_px: Number(row.uncertainty_px || 45),
      source: row.source || "COMPUTER_VISION",
      human_reviewed: row.human_reviewed === true,
      confidence: row.confidence || "LOW",
      note: row.note || "Auto-suggested field landmark; review before trusting.",
      estimate_kind: row.estimate_kind || null,
      rubber_visible: row.rubber_visible ?? null,
    });
    added += 1;
  }
  renderOverlay();
  return added;
}

function acceptLandmarkSuggestions() {
  if (state.pendingLandmarks.length === 0) {
    els.landmarkStatus.textContent = "No suggested field marks to accept.";
    return;
  }
  (state.landmarkUndoStack ||= []).push(state.landmarks.map(row=>({...row})));
  for (const suggestion of state.pendingLandmarks) {
    state.landmarks = state.landmarks.filter(row => row.landmark !== suggestion.landmark);
    state.landmarks.push({
      ...suggestion,
      human_reviewed: true,
      index: state.landmarks.length + 1,
      note: `${suggestion.note || "Auto-suggested field landmark."} Accepted after review.`,
    });
  }
  const accepted = state.pendingLandmarks.length;
  state.pendingLandmarks = [];
  reindexRows(state.landmarks);
  renderLandmarks();
  renderOverlay();
  persistDraft();
  markPredictionStale();
  els.landmarkStatus.textContent = `Accepted ${accepted} suggested field mark${accepted === 1 ? "" : "s"}.`;
}

function rejectLandmarkSuggestions() {
  fieldSuggestionMessage = 'Mark the field manually, or try detection again.';
  const rejected = state.pendingLandmarks.length;
  state.pendingLandmarks = [];
  renderOverlay();
  els.landmarkStatus.textContent = rejected
    ? `Rejected ${rejected} suggested field mark${rejected === 1 ? "" : "s"}.`
    : "No suggested field marks to reject.";
}

let contactPreloadTimer = null, preloadedContactKey = null;
let fieldSuggestionLoading = false, fieldSuggestionKey = null, dismissedFieldSuggestionKey = null;
let fieldSuggestionMessage = '';
function contactPreloadKey() {
  const pkg = buildPackage();
  return JSON.stringify([pkg.video_metadata.source_path || pkg.video_metadata.file_name,
    state.videoFile?.size, state.contactTime, contactCalibrationTime(), pkg.camera.field_xy_ft,
    pkg.camera.height_ft, pkg.field, pkg.ball_observations.filter(row => row.role === 'CONTACT_POINT').map(row => [row.image_x,row.image_y])]);
}
function scheduleContactPreload() {
  clearTimeout(contactPreloadTimer);
  contactPreloadTimer = setTimeout(() => {
    if (state.contactTime === null || !els.video.videoWidth) return;
    const key = contactPreloadKey();
    if (key !== preloadedContactKey) {
      preloadedContactKey = key;
      fetch('/api/gameframe/preload-contact', {method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({package:buildPackage()})}).then(response => {
        if (!response.ok && preloadedContactKey === key) preloadedContactKey = null;
      }).catch(() => {if(preloadedContactKey === key)preloadedContactKey = null;});
    }
    if (!state.landmarks.length && fieldSuggestionKey !== key && dismissedFieldSuggestionKey !== key) {
      state.pendingLandmarks = [];
      void suggestFieldLandmarks();
    }
  }, 350);
}

async function suggestFieldLandmarks() {
  if (!els.video.videoWidth) {
    els.landmarkStatus.textContent = "Load a video before suggesting field marks.";
    return;
  }
  const requestKey = contactPreloadKey();
  fieldSuggestionKey = requestKey;
  fieldSuggestionLoading = true;
  fieldSuggestionMessage = 'Finding field lines, home plate and the mound…';
  if (els.setupModal.open && activeWorkflowStep === 'landmarks') renderWorkflowStep('landmarks');
  els.landmarkStatus.textContent = "Suggesting field landmarks...";
  try {
    const response = await fetch("/api/landmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        frame_time_s: round(contactCalibrationTime(), 6),
        package: buildPackage(),
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      let message = text;
      try {
        const parsed = JSON.parse(text);
        message = parsed.error || parsed.stderr || parsed.stdout || text;
      } catch {
        // Keep raw response text.
      }
      throw new Error(message || `landmark suggestion failed with HTTP ${response.status}`);
    }
    const result = await response.json();
    if (requestKey !== contactPreloadKey() || dismissedFieldSuggestionKey === requestKey) return;
    const added = stageSuggestedLandmarks(result.landmarks || []);
    fieldSuggestionMessage = added ? 'Review the suggested marks before using them.' : 'No field marks found. Mark them manually or try detection again.';
    if (added && activeWorkflowStep === 'landmarks') setClickMode("landmark");
    renderOverlay();
    els.landmarkStatus.textContent = added
      ? `Review ${added} suggested field mark${added === 1 ? "" : "s"}; accept or reject.`
      : "No new field marks suggested from this frame.";
  } catch (error) {
    if(requestKey !== contactPreloadKey() || dismissedFieldSuggestionKey === requestKey)return;
    fieldSuggestionMessage = `Field detection could not finish: ${error.message || error}. Mark manually or try again.`;
    els.landmarkStatus.textContent = `Field mark suggestion failed: ${error.message || error}`;
  } finally {
    if (fieldSuggestionKey === requestKey) {
      fieldSuggestionLoading = false;
      if(requestKey !== contactPreloadKey())fieldSuggestionMessage='Camera or contact changed. Detect field marks again.';
      if (els.setupModal.open && activeWorkflowStep === 'landmarks') renderWorkflowStep('landmarks');
    }
  }
}

function setTerminalEvent({ x = null, y = null } = {}) {
  const videoTime = displayedFrameTime();
  const landingUncertaintyS = Math.max(0.5, Number(els.terminalUncertaintyFrames.value || 0.5)) * frameIntervalAt(videoTime);
  const contactUncertaintyS = state.contactUncertaintyS ?? currentStep()/2;
  const timingUncertaintyS = landingUncertaintyS + contactUncertaintyS;
  const hasImagePoint = x !== null && y !== null && Number.isFinite(Number(x)) && Number.isFinite(Number(y));
  state.terminalEvent = {
    type: "FIRST_GROUND_CONTACT",
    video_time_s: round(videoTime, 6),
    relative_time_s: round(relativeTime(videoTime), 6),
    image_x: hasImagePoint ? round(x, 2) : null,
    image_y: hasImagePoint ? round(y, 2) : null,
    timing_uncertainty_s: round(timingUncertaintyS, 6),
    landing_time_uncertainty_s: landingUncertaintyS,
    contact_uncertainty_s: contactUncertaintyS,
    position_uncertainty_px: hasImagePoint ? Number(els.uncertainty.value || 30) : null,
    source: els.pointSource.value,
    confidence: els.pointConfidence.value,
    note: hasImagePoint
      ? "Human best guess for first ground contact; treat as uncertain unless confidence is HIGH."
      : "Human tagged ground-contact frame; image location was not marked.",
  };
  markPredictionStale();
  renderTerminalEvent();
  renderOverlay();
  persistDraft();
}

function renderTerminalEvent() {
  els.terminalBody.innerHTML = "";
  if (!state.terminalEvent) {
    els.terminalStatus.textContent = "not marked";
    return;
  }
  const event = state.terminalEvent;
  const row = document.createElement("tr");
  row.innerHTML = `
    <td>${escapeHtml(event.type)}</td>
    <td>${event.video_time_s.toFixed(6)}</td>
    <td>${event.relative_time_s === null ? "" : event.relative_time_s.toFixed(6)}</td>
    <td>${event.image_x === null ? "" : event.image_x}</td>
    <td>${event.image_y === null ? "" : event.image_y}</td>
    <td>${event.timing_uncertainty_s}</td>
    <td>${event.position_uncertainty_px === null ? "" : event.position_uncertainty_px}</td>
    <td>${event.confidence}</td>
  `;
  els.terminalBody.appendChild(row);
  els.terminalStatus.textContent = event.confidence;
}

function renderApexEvent() {
  if (!state.apexEvent) {
    els.apexStatus.textContent = "apex not marked";
    return;
  }
  els.apexStatus.textContent = `apex marked at +${formatNumber(state.apexEvent.relative_time_s, 3, " s")}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

let restoringEvDraft = false;
function persistDraft() {
  if (restoringEvDraft || !state.videoFile || !window.GameFrameEvDrafts) return;
  try {
    window.GameFrameEvDrafts.schedule({package: buildPackage(), step: activeWorkflowStep,
      file: state.videoFile, detailsConfirmed: workflowDetailsConfirmed});
  } catch (error) { console.warn("Draft snapshot not ready",error); }
}

async function offerEvDraftResume() {
  if (!window.GameFrameEvDrafts || hasActiveVideoSession()) return;
  let draft;
  try { draft = await window.GameFrameEvDrafts.read(); } catch (_) { return; }
  if (!draft?.file || hasActiveVideoSession()) return;
  const notice = document.createElement("div");
  notice.className = "ev-draft-resume";
  notice.setAttribute("role", "status");
  const label = document.createElement("span");
  label.textContent = `Unfinished hit: ${draft.package.video_metadata.file_name}. `;
  const resume = document.createElement("button"); resume.type="button"; resume.textContent="Resume unfinished hit";
  const discard = document.createElement("button"); discard.type="button"; discard.textContent="Discard draft";
  resume.addEventListener("click", async () => {
    restoringEvDraft = true;
    try {
      loadVideoFile(draft.file);
      if (els.actualFieldMapModal.open) closeActualFieldMapModal();
      await new Promise(resolve => { if (els.video.readyState) resolve(); else els.video.addEventListener("loadedmetadata",resolve,{once:true}); });
      loadPackageIntoState(draft.package);
      workflowDetailsConfirmed = Boolean(draft.detailsConfirmed);
      openSetupModal(workflowSteps.includes(draft.step) ? draft.step : "contact");
      notice.remove();
    } finally { restoringEvDraft = false; }
  });
  discard.addEventListener("click", async()=>{await window.GameFrameEvDrafts.clear();notice.remove();});
  notice.append(label,resume,discard); document.body.prepend(notice);
}

function selectedGameFrameTeamId() {
  const value = Number(els.gameframeTeam?.value || 0);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function selectedGameFrameHitterId() {
  const value = Number(els.gameframeHitter?.value || 0);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function selectedGameFrameHitter() {
  const hitterId = selectedGameFrameHitterId();
  if (!hitterId) return null;
  return (state.gameframe.hitters || []).find((hitter) => Number(hitter.id) === Number(hitterId)) || null;
}

function syncTeamFromSelectedHitter() {
  if (!els.gameframeTeam) return null;
  const hitter = selectedGameFrameHitter();
  const teamId = Number(hitter?.team_id || 0);
  if (teamId > 0 && Number(els.gameframeTeam.value || 0) !== teamId) {
    els.gameframeTeam.value = String(teamId);
  }
  return teamId > 0 ? teamId : selectedGameFrameTeamId();
}

function currentFieldProfile() {
  return FIELD_PROFILES[els.fieldSize?.value] || FIELD_PROFILES["60_90"];
}

function currentFieldSizePackage() {
  const profile = currentFieldProfile();
  return {
    key: profile.key,
    label: profile.label,
    mound_distance_ft: profile.moundFt,
    base_distance_ft: profile.baseFt,
    outfield_guide_distance_ft: profile.fenceFt,
  };
}

function fieldPointFromPolar(radiusFt, deg, profile = currentFieldProfile()) {
  const home = { x: 180, y: 316 };
  const scale = 234 / Math.max(1, profile.fenceFt);
  const rad = (deg * Math.PI) / 180;
  return {
    x: home.x + Math.sin(rad) * radiusFt * scale,
    y: home.y - Math.cos(rad) * radiusFt * scale,
  };
}

function arcPathForRadius(radiusFt, profile = currentFieldProfile()) {
  const left = fieldPointFromPolar(radiusFt, -45, profile);
  const right = fieldPointFromPolar(radiusFt, 45, profile);
  const r = radiusFt * (234 / Math.max(1, profile.fenceFt));
  return `M${round(left.x, 1)} ${round(left.y, 1)} A${round(r, 1)} ${round(r, 1)} 0 0 1 ${round(right.x, 1)} ${round(right.y, 1)}`;
}

function updateFieldDiagram() {
  if (!els.fieldTool) return;
  const profile = currentFieldProfile();
  const svg = els.fieldTool.querySelector("svg");
  if (!svg) return;
  const diamondRadius = profile.baseFt * (234 / Math.max(1, profile.fenceFt));
  const first = { x: 180 + diamondRadius / Math.SQRT2, y: 316 - diamondRadius / Math.SQRT2 };
  const second = { x: 180, y: 316 - diamondRadius * Math.SQRT2 };
  const third = { x: 180 - diamondRadius / Math.SQRT2, y: 316 - diamondRadius / Math.SQRT2 };
  const infield = svg.querySelector(".infield");
  if (infield) infield.setAttribute("d", `M180 316 L${round(third.x, 1)} ${round(third.y, 1)} L${round(second.x, 1)} ${round(second.y, 1)} L${round(first.x, 1)} ${round(first.y, 1)} Z`);
  const bases = svg.querySelectorAll(".base");
  [
    { x: 180, y: 316 },
    third,
    second,
    first,
  ].forEach((point, index) => {
    if (!bases[index]) return;
    bases[index].setAttribute("cx", String(round(point.x, 1)));
    bases[index].setAttribute("cy", String(round(point.y, 1)));
  });
  svg.querySelectorAll(".distance-arc").forEach((arc, index) => {
    const radius = profile.rings[index] || profile.rings[profile.rings.length - 1];
    arc.setAttribute("d", arcPathForRadius(radius, profile));
  });
  svg.querySelectorAll(".distance-label").forEach((label, index) => {
    const radius = profile.rings[index] || profile.rings[profile.rings.length - 1];
    const point = fieldPointFromPolar(radius, -42, profile);
    label.textContent = String(radius);
    label.setAttribute("x", String(round(point.x - 2, 1)));
    label.setAttribute("y", String(round(point.y + 3, 1)));
  });
}

function setGameFrameStatus(message) {
  if (els.gameframeSaveStatus) els.gameframeSaveStatus.textContent = message;
}

function renderGameFrameOptions({ preferredTeamId = selectedGameFrameTeamId(), preferredHitterId = selectedGameFrameHitterId() } = {}) {
  if (!els.gameframeTeam || !els.gameframeHitter) return;
  const teams = state.gameframe.teams || [];
  const hitters = state.gameframe.hitters || [];
  els.gameframeTeam.innerHTML = `<option value="">Select team</option>${teams
    .map((team) => `<option value="${team.id}">${escapeHtml(team.name)}</option>`)
    .join("")}`;
  if (preferredTeamId) els.gameframeTeam.value = String(preferredTeamId);
  const teamId = selectedGameFrameTeamId();
  const filteredHitters = hitters.filter((hitter) => !teamId || Number(hitter.team_id) === Number(teamId));
  els.gameframeHitter.innerHTML = `<option value="">Select hitter</option>${filteredHitters
    .map((hitter) => `<option value="${hitter.id}">${escapeHtml(hitter.name)}</option>`)
    .join("")}`;
  if (preferredHitterId && filteredHitters.some((hitter) => Number(hitter.id) === Number(preferredHitterId))) {
    els.gameframeHitter.value = String(preferredHitterId);
    syncTeamFromSelectedHitter();
  }
}

async function loadGameFrameOptions(preferred = {}) {
  try {
    const response = await fetch("/api/gameframe/options", { method: "POST", cache: "no-store" });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    state.gameframe.teams = data.teams || [];
    state.gameframe.hitters = data.hitters || [];
    let remembered = {};
    try { remembered = JSON.parse(localStorage.getItem('gameframe-ev-people') || '{}') || {}; } catch (_) {}
    const rememberedTeam = state.gameframe.teams.find(team => Number(team.id) === Number(remembered.team));
    const rememberedHitter = state.gameframe.hitters.find(hitter => Number(hitter.id) === Number(remembered.hitter) && Number(hitter.team_id) === Number(rememberedTeam?.id));
    renderGameFrameOptions({
      preferredTeamId: selectedGameFrameTeamId() || rememberedTeam?.id || null,
      preferredHitterId: selectedGameFrameHitterId() || rememberedHitter?.id || null,
      ...preferred,
    });
    if (activeWorkflowStep === "player" && els.setupModal?.open) renderWorkflowStep("player");
  } catch (error) {
    setGameFrameStatus("player list unavailable");
    console.error(error);
  }
}

function rememberGameFramePeople() {
  try {
    localStorage.setItem('gameframe-ev-people', JSON.stringify({team:selectedGameFrameTeamId(),hitter:selectedGameFrameHitterId()}));
  } catch (_) {
    // Browsing without storage must not prevent saving a measurement.
  }
}

async function addGameFrameTeam() {
  const name = els.newTeamName?.value.trim();
  if (!name) return;
  setGameFrameStatus("adding team...");
  const response = await fetch("/api/gameframe/team", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not add team.");
  state.gameframe.teams = data.teams || [];
  state.gameframe.hitters = data.hitters || [];
  els.newTeamName.value = "";
  renderGameFrameOptions({ preferredTeamId: data.team?.id });
  setGameFrameStatus("team added");
}

async function addGameFrameHitter() {
  const teamId = selectedGameFrameTeamId();
  const name = els.newHitterName?.value.trim();
  if (!teamId || !name) {
    setGameFrameStatus("select team first");
    return;
  }
  setGameFrameStatus("adding hitter...");
  const response = await fetch("/api/gameframe/hitter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ team_id: teamId, name }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not add hitter.");
  state.gameframe.teams = data.teams || [];
  state.gameframe.hitters = data.hitters || [];
  els.newHitterName.value = "";
  renderGameFrameOptions({ preferredTeamId: teamId, preferredHitterId: data.hitter?.id });
  setGameFrameStatus("hitter added");
  if (document.getElementById('ev-people-modal').open) await continueEvPeopleSelection();
}

function evSaveCompletionMessage() {
  if(state.gameframe.swingSaveWarning)return state.gameframe.swingSaveWarning;
  const status=state.gameframe.videoRenderStatus;
  if(status==='error')return 'Hit saved. The video could not finish. Use "Retry video" to try again; your measurement and source clip are safe.';
  if(status&&status!=='ready')return 'Hit saved. Your video is preparing in the background. You can finish swing timing or open Library now.';
  return state.gameframe.relatedCopyJobId?'Hit and video saved. Preparing the swing timing copy...':'Hit and video saved. The swing timing copy is ready.';
}

function updateEvCompletionCopyStatus() {
  if (state.gameframe.pendingSwingId) preloadSavedSwingVideo(state.gameframe.pendingSwingId);
  const notice = document.getElementById('ev-complete-notice');
  if (notice) {
    notice.textContent = evSaveCompletionMessage();
    notice.hidden = false;
  }
  const finish = document.getElementById('ev-complete-timing');
  if (finish) {
    const pending = Boolean(state.gameframe.relatedCopyJobId);
    finish.hidden = !pending && !state.gameframe.pendingSwingId;
    finish.disabled = pending;
    finish.classList.toggle('is-loading',pending);
    finish.textContent = pending ? 'Preparing swing timing...' : 'Finish swing timing';
  }
}

let swingVideoPreloader = null, preloadedSwingId = null;
function preloadSavedSwingVideo(id) {
  if (preloadedSwingId === id) return;
  preloadedSwingId = id;
  if (window.parent !== window && document.referrer) {
    window.parent.postMessage({type:'gameframe:preload-swing',id},new URL(document.referrer).origin);
    return;
  }
  if (swingVideoPreloader) {swingVideoPreloader.removeAttribute('src');swingVideoPreloader.load();}
  swingVideoPreloader = document.createElement('video');
  swingVideoPreloader.preload = 'auto';
  swingVideoPreloader.muted = true;
  swingVideoPreloader.src = `/multi-swing/pending/video?id=${encodeURIComponent(id)}`;
  swingVideoPreloader.load();
}

async function monitorRelatedCopies(jobId) {
  try {
    for (let attempt=0; attempt<600; attempt++) {
      if (state.gameframe.relatedCopyJobId !== jobId) return;
      const response = await fetch(`/api/clip/status?id=${encodeURIComponent(jobId)}`, {cache:'no-store'});
      const result = await response.json();
      if (!response.ok || result.status === 'error') throw new Error(result.error || 'Timing copy preparation failed.');
      if (state.gameframe.relatedCopyJobId !== jobId) return;
      if (result.status === 'done') {
        state.gameframe.pendingSwingId = Number(result.pending_swing_id) || null;
        state.gameframe.swingSaveWarning = [result.swing_warning,result.pitch_warning].filter(Boolean).join(' ');
        state.gameframe.relatedCopyJobId = null;
        state.gameframe.libraryNotice = evSaveCompletionMessage();
        updateEvCompletionCopyStatus();
        return;
      }
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    throw new Error('The timing copy is still being prepared. Check the swing library shortly.');
  } catch (error) {
    if (state.gameframe.relatedCopyJobId !== jobId) return;
    state.gameframe.relatedCopyJobId = null;
    state.gameframe.swingSaveWarning = `EV saved. ${error.message || error}`;
    updateEvCompletionCopyStatus();
  }
}

let measurementSaveRequest=null;
async function saveHitTrack({ clipJobId = null, deferVideo = false } = {}) {
  const teamId = syncTeamFromSelectedHitter();
  const hitterId = selectedGameFrameHitterId();
  if (state.contactTime === null) {
    setGameFrameStatus("set contact first");
    return;
  }
  setGameFrameStatus("saving...");
  if (!state.latestPrediction) {
    await runLivePrediction({ openModal: false });
  }
  const measurement=buildPackage(),prediction=state.latestPrediction;
  const identity=JSON.stringify([state.videoFile?.name,state.videoFile?.size,state.videoFile?.lastModified,teamId,hitterId,currentHitDescription(),measurement,prediction]);
  if(!measurementSaveRequest||measurementSaveRequest.identity!==identity)measurementSaveRequest={identity,key:window.crypto?.randomUUID?.()||Date.now().toString(36)+"-"+Math.random().toString(36).slice(2)};
  const response = await fetch("/api/gameframe/save-hit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      team_id: teamId,
      hitter_id: hitterId,
      description: currentHitDescription(),
      clip_job_id: clipJobId,
      defer_video_render: deferVideo,
      video_banner_text: clipBannerLines().join("|"),
      save_request_key: measurementSaveRequest.key,
      create_pitch: state.gameframe.createPitch === true,
      defer_copy_preparation: true,
      package: measurement,
      prediction,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not save hit.");
  state.gameframe.swingSaveWarning = [data.swing_warning, data.pitch_warning].filter(Boolean).join(' ');
  state.gameframe.pendingSwingId = Number(data.pending_swing_id) || null;
  if (state.gameframe.pendingSwingId) preloadSavedSwingVideo(state.gameframe.pendingSwingId);
  state.gameframe.savedHitId = Number(data.id) || null;
  state.gameframe.videoRenderStatus = data.video_status || "ready";
  state.gameframe.videoRenderError = null;
  state.gameframe.relatedCopyJobId = data.copy_job_id || null;
  state.gameframe.copyReadyPromise = data.copy_job_id ? monitorRelatedCopies(data.copy_job_id) : null;
  setGameFrameStatus(evSaveCompletionMessage());
  return data;
}

function manualBallPathHintPackage() {
  const manualBallPoints = state.observations
    .filter((obs) => isManualBallObservation(obs)
      && Number.isFinite(Number(obs.image_x))
      && Number.isFinite(Number(obs.image_y))
      && Number.isFinite(Number(obs.relative_time_s)))
    .sort((a, b) => Number(a.relative_time_s || 0) - Number(b.relative_time_s || 0));
  if (manualBallPoints.length < 2) return null;
  return {
    kind: "manual_ball_path_hint",
    width_px: 96,
    points: manualBallPoints.slice(0, 8).map((obs) => ({
      x: Number(obs.image_x),
      y: Number(obs.image_y),
    })),
  };
}

function buildPackage() {
  const metadata = state.videoMetadata || {};
  const field = currentFieldSizePackage();
  return {
    schema_version: "0.1-research",
    skipped_video_marks: state.skippedVideoMarks || [],
    video_metadata: {
      file_name: state.fileName || metadata.file_name || null,
      source_path: metadata.source_path || null,
      width_px: els.video.videoWidth || metadata.width_px || null,
      height_px: els.video.videoHeight || metadata.height_px || null,
      duration_s: els.video.duration ? round(els.video.duration, 6) : metadata.duration_s ?? null,
      timing_source: metadata.timing_source || "browser_media_time",
      frame_step_assumption_s: currentStep(),
      fps: metadata.fps || 1/currentStep(),
      frame_times_s: state.frameTimes || [],
      variable_frame_rate: metadata.variable_frame_rate || false,
      description: currentHitDescription() || null,
      field_size_key: field.key,
      field_size_label: field.label,
      detection_brush: manualBallPathHintPackage(),
    },
    hit: {
      description: currentHitDescription() || null,
      gameframe_team_id: selectedGameFrameTeamId(),
      gameframe_hitter_id: selectedGameFrameHitterId(),
      player_name: state.gameframe.hitters.find(hitter => Number(hitter.id) === selectedGameFrameHitterId())?.name || null,
      contact: state.contactTime === null
        ? null
        : {
            timestamp_s: round(state.contactTime, 6),
            frame_timestamp_s: round(contactCalibrationTime(),6),
            timing_mode: state.contactTimingMode,
            uncertainty_s: state.contactUncertaintyS ?? currentStep()/2,
            confidence: els.contactConfidence.value,
            source: "HUMAN",
          },
      direction_observation: {
        value: els.direction.value,
        source: "HUMAN",
      },
      distance_observation: currentDistanceObservation(),
      apex_observation: state.apexEvent === null
        ? null
        : {
            relative_time_s: round(state.apexEvent.relative_time_s, 6),
            height_ft: null,
            confidence: state.apexEvent.confidence,
            time_uncertainty_s: round(state.apexEvent.timing_uncertainty_s, 6),
            source: state.apexEvent.source,
            note: "Apex frame was tagged visually; estimate height from launch angle and time-to-apex.",
          },
    },
    camera: {
      vantage: els.cameraVantage.value,
      field_marker_percent: {
        x: round(markers.camera.x, 2),
        y: round(markers.camera.y, 2),
      },
      field_xy_ft: actualFieldMapState.fieldGeometry?.camera_xy_ft
        ? {
            x: round(actualFieldMapState.fieldGeometry.camera_xy_ft.x, 3),
            y: round(actualFieldMapState.fieldGeometry.camera_xy_ft.y, 3),
          }
        : null,
      actual_field_map: actualFieldMapState.fieldGeometry || null,
      height_ft: Number(els.cameraHeightFt.value || 0),
      motion_note: state.cameraChangedDuringMarks ? "camera changed between ball marks" : "stationary near contact; panning may occur later",
      changed_during_ball_marks: state.cameraChangedDuringMarks === true,
      source: "HUMAN",
    },
    field,
    field_size: field,
    landmarks: state.landmarks,
    terminal_event: state.terminalEvent,
    ball_observations: state.observations,
  };
}

function download(name, type, contents) {
  const blob = new Blob([contents], { type });
  downloadBlob(name, blob);
}

function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvValue(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function observationsToCsv() {
  const header = [
    "index",
    "video_time_s",
    "relative_time_s",
    "image_x",
    "image_y",
    "uncertainty_px",
    "source",
    "confidence",
    "note",
  ];
  const rows = state.observations.map((obs) =>
    header.map((key) => csvValue(obs[key])).join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

function formatRange(values, suffix = "") {
  if (!Array.isArray(values) || values.length < 2) return "";
  const low = round(values[0], 0);
  const high = round(values[1], 0);
  if (low === null || high === null) return "";
  if (low === high) return `${low.toFixed(0)}${suffix}`;
  return `${low.toFixed(0)}-${high.toFixed(0)}${suffix}`;
}

function formatBestGuess(best, options = {}) {
  const evKey = options.evKey || "exit_velocity_mph";
  const laKey = options.laKey || "launch_angle_deg";
  const distanceKey = options.distanceKey || "distance_ft";
  const prefix = options.prefix || "";
  const compact = Boolean(options.compact);
  const evSuffix = options.evSuffix ?? (compact ? " mph" : " mph EV");
  const laSuffix = options.laSuffix ?? (compact ? " degrees" : " deg LA");
  const distanceSuffix = options.distanceSuffix ?? (compact ? " feet" : " ft");
  const prefixedNumber = (value, digits, suffix) => {
    const rounded = round(value, digits);
    if (rounded === null) return "";
    return `${prefix}${rounded.toFixed(digits)}${suffix}`;
  };
  const parts = [
    prefixedNumber(best?.[evKey], 0, evSuffix),
    prefixedNumber(best?.[laKey], 0, laSuffix),
    prefixedNumber(best?.[distanceKey], 0, distanceSuffix),
  ].filter(Boolean);
  return parts.length ? parts.join(" / ") : "estimate not available";
}

function isDiagnosticPrediction(prediction = state.latestPrediction) {
  return prediction?.method === "uncalibrated_path_shape_diagnostic"
    || prediction?.identifiability?.identifiable === false;
}

function practicalEstimate(prediction = state.latestPrediction) {
  if (prediction?.distance_review?.required) return null;
  const rows = prediction?.ev_candidates || prediction?.unconstrained?.top || [];
  return rows[0] || null;
}

function plainEstimateText(best = practicalEstimate(), prediction = state.latestPrediction) {
  if (!best) return "Load prediction for EV / LA / distance";
  return isDiagnosticPrediction(prediction)
    ? formatBestGuess(best, { prefix: "~", compact: true })
    : formatBestGuess(best, { compact: true });
}

function currentHitDescription() {
  return String(els.hitDescription?.value || "").trim();
}

function actualFieldMapGeometryReady() {
  const geometry = actualFieldMapState.fieldGeometry;
  return Boolean(
    geometry
      && geometry.source === "actual_field_map"
      && geometry.camera_xy_ft
      && geometry.landing_xy_ft
      && Number.isFinite(Number(geometry.landing_distance_ft))
      && Number.isFinite(Number(geometry.landing_angle_deg)),
  );
}

function requiredVideoLandmarksReady() {
  const marked = new Set(
    state.landmarks
      .filter((row) => row.image_x !== null && row.image_y !== null)
      .map((row) => row.landmark),
  );
  return LANDMARK_SEQUENCE.every((landmark) => marked.has(landmark) || state.skippedVideoMarks?.includes(`field:${landmark}`));
}

function nextRequiredVideoLandmark() {
  const marked = new Set(
    state.landmarks
      .filter((row) => row.image_x !== null && row.image_y !== null)
      .map((row) => row.landmark),
  );
  return LANDMARK_SEQUENCE.find((landmark) => !marked.has(landmark) && !state.skippedVideoMarks?.includes(`field:${landmark}`)) || null;
}

function videoLandmarkPrompt(landmark) {
  if (landmark === "first_baseline_near") return "Tag a visible point on the first-base line";
  if (landmark === "first_baseline_far") return "Tag another point farther along the first-base line";
  if (landmark === "third_baseline_near") return "Tag a visible point on the third-base line";
  if (landmark === "third_baseline_far") return "Tag another point farther along the third-base line";
  if (landmark === "home_plate") return "Tag Home Plate";
  if (landmark === "pitching_rubber") return "Tag the Pitching Rubber";
  return "Tag Field Landmark";
}

function currentDistanceObservation() {
  const mapGeometry = actualFieldMapState.fieldGeometry;
  const mapLanding = mapGeometry?.landing_xy_ft;
  const mapDistance = Number(mapGeometry?.landing_distance_ft);
  const mapSpray = Number(mapGeometry?.landing_angle_deg);
  const distanceFt = Number.isFinite(mapDistance) ? Math.round(mapDistance) : null;
  const hasMapLanding = mapGeometry && Number.isFinite(mapDistance);
  return {
    distance_ft: Number.isFinite(distanceFt) ? distanceFt : null,
    uncertainty_ft: Number.isFinite(distanceFt)
      ? (LANDING_CERTAINTY_OPTIONS[state.distanceCertainty]?.feet || state.savedDistanceUncertaintyFt || ACTUAL_FIELD_MAP_DISTANCE_UNCERTAINTY_FT)
      : null,
    confidence: hasMapLanding ? (LANDING_CERTAINTY_OPTIONS[state.distanceCertainty]?.confidence || state.savedDistanceConfidence || "HIGH") : null,
    landing_certainty: state.distanceCertainty || null,
    source: hasMapLanding ? "ACTUAL_FIELD_MAP" : null,
    spray_angle_deg: Number.isFinite(mapSpray) ? round(mapSpray, 3) : null,
    terminal_ground_xy_ft: mapLanding
      ? {
          x: round(mapLanding.x, 3),
          y: round(mapLanding.y, 3),
        }
      : null,
    actual_field_map: mapGeometry || null,
    field_marker_percent: null,
  };
}

function updateEstimateBanner() {
  if (!els.estimateSummary) return;
  els.estimateSummary.textContent = plainEstimateText();
  const description = currentHitDescription();
  els.estimateDescription.textContent = description || "No description";
}

function summarizeCandidateRange(rows) {
  if (!rows?.length) return null;
  const finiteValues = (key) => rows
    .map((row) => Number(row[key]))
    .filter((value) => Number.isFinite(value));
  const rangeFor = (key) => {
    const values = finiteValues(key);
    return values.length ? [Math.min(...values), Math.max(...values)] : null;
  };
  return {
    ev_mph: rangeFor("exit_velocity_mph"),
    launch_angle_deg: rangeFor("launch_angle_deg"),
    distance_ft: rangeFor("distance_ft"),
    hang_time_s: rangeFor("hang_time_s"),
  };
}

function bestClusterRows(rows, limit = 5) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const best = rows[0];
  const bestScore = Number(best.score ?? best.total_score ?? best.pixel_rmse ?? 0);
  const bestRmse = Number(best.pixel_rmse);
  const scored = rows.filter((row) => row && Number.isFinite(Number(row.exit_velocity_mph)));
  if (!scored.length) return [];
  const close = scored.filter((row, index) => {
    if (index === 0) return true;
    const score = Number(row.score ?? row.total_score);
    const rmse = Number(row.pixel_rmse);
    if (Number.isFinite(bestRmse) && Number.isFinite(rmse)) {
      return rmse <= bestRmse + 4 || rmse <= bestRmse * 1.12;
    }
    if (Number.isFinite(bestScore) && Number.isFinite(score)) {
      return score <= bestScore + Math.max(4, Math.abs(bestScore) * 0.08);
    }
    return index < limit;
  });
  return (close.length >= 2 ? close : scored).slice(0, limit);
}

function summarizeBestCluster(rows, limit = 5) {
  return summarizeCandidateRange(bestClusterRows(rows, limit));
}

function cappedRangeAround(bestValue, rawRange, maxHalfWidth) {
  const center = Number(bestValue);
  if (!Number.isFinite(center)) return rawRange || null;
  const low = Array.isArray(rawRange) && Number.isFinite(Number(rawRange[0]))
    ? Math.max(Number(rawRange[0]), center - maxHalfWidth)
    : center - maxHalfWidth;
  const high = Array.isArray(rawRange) && Number.isFinite(Number(rawRange[1]))
    ? Math.min(Number(rawRange[1]), center + maxHalfWidth)
    : center + maxHalfWidth;
  if (low > high) return [center - maxHalfWidth, center + maxHalfWidth];
  return [low, high];
}

function markerLeaningRangeAround(bestValue, rawRange, maxHalfWidth, markerValue) {
  const center = Number(bestValue);
  if (!Number.isFinite(center)) return rawRange || null;
  let [low, high] = cappedRangeAround(center, rawRange, maxHalfWidth);
  const marker = Number(markerValue);
  if (!Number.isFinite(marker)) return [low, high];
  const lean = Math.min(35, Math.max(maxHalfWidth, Math.abs(marker - center) * 0.65));
  if (marker > center) {
    high = Math.max(high, center + lean);
    low = Math.max(low, center - maxHalfWidth);
    high = Math.min(high, marker + 10);
  } else if (marker < center) {
    low = Math.min(low, center - lean);
    high = Math.min(high, center + maxHalfWidth);
    high = Math.min(high, Math.max(center + 5, marker + 15));
  }
  return [low, high];
}

function displayedLikelyBands(best, rawRange) {
  if (state.latestPrediction?.method === 'direction_first_shared_synthetic_match') return rawRange || {};
  const endpointDistance = endpointMarkerDistanceFt();
  return {
    ev_mph: cappedRangeAround(best?.exit_velocity_mph, rawRange?.ev_mph, 2),
    launch_angle_deg: cappedRangeAround(best?.launch_angle_deg, rawRange?.launch_angle_deg, 2),
    distance_ft: markerLeaningRangeAround(best?.distance_ft, rawRange?.distance_ft, 10, endpointDistance),
    hang_time_s: cappedRangeAround(best?.hang_time_s, rawRange?.hang_time_s, 0.35),
  };
}

function displayCameraLaRange(la) {
  if (!la?.launch_angle_range_deg) return "";
  return formatRange(cappedRangeAround(la.launch_angle_deg, la.launch_angle_range_deg, 2), " deg");
}

function landingDirectionAllowance(prediction) {
  return prediction?.direction_first_match?.spray_refinement?.map_half_width_deg ?? 6;
}

function usesDescentRate(prediction){return prediction?.direction_first_match?.late_descent_rate?.used===true;}

function plainEstimateExplanation(best, prediction) {
  if(usesDescentRate(prediction))return 'Early marks establish launch geometry. Reliable camera-corrected descent rate and rise/descent timing provide independent speed evidence. The landing allowance limits compatible flights; it does not prescribe their spread. Absolute late height and horizontal position are excluded.'+(prediction.direction_first_match.angle_primary?' The calculated launch angle stays fixed.':'');
  if (prediction?.direction_first_match?.angle_primary) return 'The calculated launch angle is held fixed using the early marks, camera geometry and your marked direction. Distance can refine speed; it cannot lower the angle to make the distance fit. '+(prediction.direction_first_match.late_evidence_policy==='timing_only'?'Later marks constrain rise/descent timing, not absolute height. ':'')+'The displayed angle range describes measurement uncertainty.';
  if (prediction?.direction_first_match?.late_evidence_policy==='timing_only') return 'Early marks constrain launch angle. Later marks constrain reliable rise/descent timing, not absolute height or horizontal position. Camera-affected reversals leave timing uncertain instead of forcing a different flight.';
  if (prediction?.angle_constraint_policy?.mode === 'near_line_of_sight_user_inputs') return 'The ball travels nearly along the camera viewing direction, so the video cannot constrain launch angle as well. Distance and timing inputs have more influence; this is a conditional estimate.';
  if (prediction?.launch_angle_uncertainty?.poorly_constrained) return `${prediction.launch_angle_uncertainty.reason} The angle range includes sampled camera, direction and marking uncertainty; it is not a guaranteed accuracy interval. Speed remains conditional on the fitted geometry, contact depth and available flight evidence.`;
  if (prediction?.estimation_pipeline === 'early_geometry_then_late_height') {
    if (prediction.camera_motion) return 'Early marks constrain launch angle. Reliable camera-corrected later heights constrain speed, apex and descent. Later positions with uncertain camera alignment are excluded. The angle range includes sampled camera, direction and marking uncertainty; speed remains conditional on the fitted geometry and contact depth.';
    return 'Early marks constrain the 3D launch angle before later vertical positions estimate speed. Sideways panning is allowed with a level camera and no zoom. Landing distance checks plausible flights; the range is conditional on camera geometry and marking accuracy.';
  }
  if (prediction?.method === 'direction_first_shared_synthetic_match') {
    return (prediction.direction_first_match?.selection_policy
      ? `We allow some uncertainty in where the ball landed. Within ${landingDirectionAllowance(prediction)} degrees of your marked direction, trajectories that fit the video similarly well are ranked by closeness to your estimated distance. `
      : 'Video path and camera orientation set launch angle before comparing speeds. Marked distance is a separate cross-check, not a fitted input. ') +
      (prediction.direction_first_match?.acceptable === false ? 'The timed-position fit misses tolerance; this is an uncertain speed estimate. ' : '') +
      (prediction.direction_first_match?.at_speed_boundary ? 'The best row is at the edge of the stored speed range; its speed is not a resolved measurement.' : 'The estimate remains conditional on camera calibration and ball-position accuracy.');
  }
  const pieces = [];
  const hasGroundContact =
    state.terminalEvent?.type === "FIRST_GROUND_CONTACT" &&
    state.terminalEvent?.relative_time_s !== undefined &&
    state.terminalEvent?.relative_time_s !== null;
  const targetHang = hasGroundContact ? state.terminalEvent.relative_time_s : null;
  const fieldDirection = prediction?.field_direction || {};
  const predictionDistance = Number(fieldDirection.estimated_distance_ft);
  const observedDistance = Number(currentDistanceObservation()?.distance_ft);
  const endpointDistance = Number.isFinite(predictionDistance)
    ? predictionDistance
    : Number.isFinite(observedDistance) ? observedDistance : null;
  const source = String(fieldDirection.source || currentDistanceObservation()?.source || "").toLowerCase();
  const distanceSource = "actual field map";
  const distanceText = distanceConfidenceText(prediction);
  const fitText = syntheticFitText(best, prediction);
  const directLa = prediction?.direct_launch_angle?.launch_angle_deg;
  const bestLa = best?.launch_angle_deg;
  if (targetHang !== undefined && targetHang !== null) {
    pieces.push(`The marked hang time is ${formatNumber(targetHang, 0, " s")}, so the estimate favors synthetic flights with similar hang time.`);
  }
  if (endpointDistance !== null) {
    pieces.push(`The ${distanceSource} is used as a ${formatNumber(endpointDistance, 0, " ft")} distance estimate; distance confidence is ${distanceText.toLowerCase()}.`);
  }
  if (fitText) {
    pieces.push(`Synthetic fit: ${fitText}.`);
  }
  if (directLa !== undefined && directLa !== null) {
    if (hasGroundContact) {
      pieces.push(`The constrained camera geometry gives about ${formatNumber(directLa, 0, " deg")} LA, and the marked hang time helps choose the practical synthetic flight.`);
    } else if (bestLa !== undefined && bestLa !== null && bestLa > directLa + 1.5) {
      pieces.push(`The constrained camera geometry gives about ${formatNumber(directLa, 0, " deg")} LA; without ground contact, the final LA is chosen from the best distance, direction, and projected-path fit.`);
    } else {
      pieces.push(`The constrained camera geometry gives about ${formatNumber(directLa, 0, " deg")} LA.`);
    }
  }
  pieces.push(`The displayed band is intentionally tight around the best working estimate; it is not the full theoretical ambiguity range.`);
  return pieces.join(" ");
}

function distanceConfidenceText(prediction) {
  const fieldDirection = prediction?.field_direction || {};
  const observation = currentDistanceObservation() || {};
  const confidence = String(observation.confidence || fieldDirection.confidence || "UNKNOWN").toUpperCase();
  const uncertainty = Number(observation.uncertainty_ft ?? fieldDirection.distance_uncertainty_ft);
  const source = String(fieldDirection.source || observation.source || "").toLowerCase();
  const sourceText = source.includes("actual_field_map") ? "actual field map" : "map distance";
  const uncertaintyText = Number.isFinite(uncertainty)
    ? `, +/- ${formatNumber(uncertainty, 0, " ft")}`
    : "";
  return `${confidence}${uncertaintyText} from ${sourceText}`;
}

function syntheticFitText(best, prediction) {
  if(usesDescentRate(prediction))return `${prediction.direction_first_match.early_used_count} early position marks; ${prediction.direction_first_match.late_descent_rate_used_count} camera-corrected descent marks used for speed. ${formatNumber(best?.projected_path_rmse_px,1,' px')} early-position error.`;
  if (prediction?.estimation_pipeline === 'early_geometry_then_late_height') {
    const match = prediction.direction_first_match;
    return match.late_evidence_policy==='timing_only' ? `${match.early_used_count} early position marks; ${match.late_timing_used_count} later marks used for timing. ${formatNumber(best?.projected_path_rmse_px, 1, ' px')} early-position error.` : `${match.early_used_count} early position marks, ${match.late_vertical_used_count} later height marks; ${formatNumber(best?.projected_path_rmse_px, 1, ' px')} scored error`;
  }
  const evidence = prediction?.projected_path_evidence || {};
  const usable = Number(evidence.usable_point_count ?? evidence.used_count);
  const maxPoints = Number(evidence.max_strength_point_count);
  const rmse = Number(best?.projected_path_rmse_px ?? evidence.best_rmse_px ?? evidence.pixel_rmse);
  const strength = Number(evidence.path_evidence_strength);
  const score = Number(best?.score ?? best?.total_score);
  const parts = [];
  if (Number.isFinite(score)) {
    parts.push(`score ${formatNumber(score, 1, "")}`);
  }
  if (Number.isFinite(rmse)) {
    parts.push(`path error ${formatNumber(rmse, 0, " px")}`);
  }
  if (Number.isFinite(usable)) {
    parts.push(Number.isFinite(maxPoints) ? `${usable}/${maxPoints} early points` : `${usable} early points`);
  }
  if (Number.isFinite(strength)) {
    parts.push(`evidence strength ${formatNumber(strength * 100, 0, "%")}`);
  }
  return parts.join(", ");
}

function pathOnlyModelText(prediction) {
  const fit = prediction?.path_only_model_fit || {};
  const best = fit.best || fit.candidates?.[0];
  if (!best) return fit.diagnostics?.used ? "Not independently determined" : "not available";
  return `${formatBestGuess(best)}; ${formatNumber(best.projected_path_rmse_px, 1, " px RMS")}`;
}

function estimateConfidenceText(best, prediction) {
  if(usesDescentRate(prediction))return prediction.direction_first_match.acceptable
    ? `${prediction.export_readiness?.confidence||'CONDITIONAL'}: early launch geometry, camera-corrected descent rate, and landing allowance. Absolute late positions are excluded.`
    : 'Review needed: no modeled flight satisfies the early geometry, reliable later motion and landing allowance together.';
  if (prediction?.direction_first_match?.late_evidence_policy==='timing_only' && prediction.direction_first_match.acceptable) return `${prediction.export_readiness?.confidence || 'CONDITIONAL'}: early launch geometry, entered distance and reliable later rise/descent timing. Later absolute heights are not used.`;
  if (prediction?.estimation_pipeline === 'early_geometry_then_late_height' && prediction.direction_first_match?.acceptable) {
    return 'Early marks constrain launch angle; later ball heights estimate speed. The landing-distance allowance and camera geometry still affect the range.';
  }
  if (prediction?.method === "direction_first_shared_synthetic_match") {
    if (prediction.direction_first_match?.spray_refinement?.at_search_boundary) {
      return "LOW: the best spray is near the edge of the direction search. The mapped direction range may need review.";
    }
    if (prediction.direction_first_match?.acceptable === false) {
      if (prediction.direction_first_match.late_evidence_policy==='timing_only') return 'LOW: no tested flight reconciles the early geometry, reliable rise/descent timing and entered distance. Later absolute heights are not used.';
      return `LOW: ${formatNumber(best?.projected_path_rmse_px, 1, " px")} RMS position error exceeds the fit requirements. Speed is uncertain.`;
    }
    if (prediction.direction_first_match?.at_speed_boundary) {
      return "Closest stored match is at the edge of the available speed range for this direction. This is not an exact speed measurement; more synthetic speed coverage is needed.";
    }
    return prediction.direction_first_match?.selection_policy
      ? "Several speeds and launch angles follow the ball positions you selected. The landing distance you entered helps choose between them; the video has not independently measured that distance."
      : "Video launch is held fixed while nearby spray angles and speeds are compared. The estimate is not independently validated.";
  }
  if (prediction?.method === "joint_calibrated_pixels_and_supplied_landing_distance") {
    return "Distance-constrained estimate: reviewed free-flight points fit the supplied landing distance. Speed and distance are not independently validated by video alone.";
  }
  const evidence = prediction?.projected_path_evidence || {};
  const usable = Number(evidence.usable_point_count ?? evidence.used_count);
  const maxPoints = Number(evidence.max_strength_point_count || 8);
  const strength = Number(evidence.path_evidence_strength);
  const distanceText = distanceConfidenceText(prediction);
  const highDistance = distanceText.startsWith("HIGH");
  const mediumDistance = distanceText.startsWith("MEDIUM");
  const identifiable = prediction?.identifiability?.identifiable !== false;
  const hasGroundContact = Boolean(best?.ground_contact_confidence);
  const view = String(prediction?.view_geometry?.classification || "").toLowerCase();
  const depthHeavy = view.includes("depth_heavy");
  if (identifiable && highDistance && Number.isFinite(strength) && strength >= 0.8 && Number.isFinite(usable) && usable >= Math.min(8, maxPoints)) {
    return depthHeavy && !hasGroundContact
      ? "MEDIUM-HIGH: strong 8-point synthetic path fit and high-confidence map distance; still not full confidence because the view is depth-heavy and ground contact was not used."
      : "HIGH: strong synthetic path fit, high-confidence distance, and separated top matches.";
  }
  if (identifiable && (highDistance || mediumDistance) && Number.isFinite(strength) && strength >= 0.6 && Number.isFinite(usable) && usable >= 5) {
    return "MEDIUM: usable synthetic path fit and distance evidence, with remaining uncertainty from camera angle or missing landing/bounce timing.";
  }
  if (identifiable) {
    return "LOW-MEDIUM: the best synthetic row can be ranked, but the supporting path or distance evidence is limited.";
  }
  return "LOW: the marks do not separate the synthetic candidates cleanly yet.";
}

function launchAngleReasonText(best, prediction) {
  if(usesDescentRate(prediction))return 'Launch geometry comes from the early marks. Later descent rate constrains speed; in angle-first views the calculated launch angle stays fixed.';
  if (prediction?.direction_first_match?.late_evidence_policy==='timing_only') return 'Launch angle comes from the early spatial geometry. Later marks constrain rise/descent timing, not absolute height. The calculated angle is held fixed in side and oblique views.';
  if (prediction?.estimation_pipeline === 'early_geometry_then_late_height') {
    return 'Launch angle is derived from early 3D spatial geometry without fitting speed or using the later marks. Each angle hypothesis stays fixed while later vertical marks estimate speed.';
  }
  if (prediction?.method === "direction_first_shared_synthetic_match") {
    return prediction.direction_first_match?.selection_policy
      ? (prediction.direction_first_match?.database_grid === 'uniform'
        ? `Speed, launch and spray are selected from the complete simulation grid. A match must fit both the timed video points and your marked landing distance. Landing direction may vary by ${landingDirectionAllowance(prediction)} degrees either way.`
        : prediction.direction_first_match?.refinement
        ? `Launch, spray and speed are fitted together between stored trajectories. A match must fit both the timed video points and your marked landing distance. Landing direction may vary by ${landingDirectionAllowance(prediction)} degrees either way.`
        : "Launch and spray angle were selected together from stored trajectories, with distance used to choose among similar video fits.")
      : "Launch is selected from video direction and held fixed. Nearby spray angles and speeds are compared within a range around the mapped direction.";
  }
  if (prediction?.method === "joint_calibrated_pixels_and_supplied_landing_distance") {
    return "Launch angle, launch direction, and contact location are fitted together from free-flight points and landing measurements. The contact-frame mark is excluded from the motion fit.";
  }
  const la = prediction?.direct_launch_angle || {};
  const directLa = Number(la.launch_angle_deg);
  const raw2d = Number(la.literal_2d_rise_angle_deg);
  const depth = Number(la.line_of_sight_depth_alignment);
  const across = Number(la.line_of_sight_effective_across_component ?? la.line_of_sight_across_component);
  const bestLa = Number(best?.launch_angle_deg);
  const parts = [];
  if (Number.isFinite(raw2d)) {
    parts.push(`The first ball points rise at about ${formatNumber(raw2d, 0, " deg")} on screen.`);
  }
  if (Number.isFinite(depth) && Number.isFinite(across)) {
    const depthAngle = Math.asin(Math.max(-1, Math.min(1, depth))) * 180 / Math.PI;
    const source = String(prediction?.field_direction?.source || "").toLowerCase().includes("actual_field_map")
      ? "actual field map"
      : "actual field map";
    const detail = Number.isFinite(directLa)
      ? ` The final camera-adjusted LA is ${formatNumber(directLa, 0, " deg")}.`
      : "";
    parts.push(`Using the ${source}, the hit direction is ${formatNumber(depth * 100, 0, "%")} aligned with camera depth (${formatNumber(depthAngle, 0, " deg")} off pure side-view), leaving ${formatNumber(across * 100, 0, "%")} sideways relative to the camera line of sight. This is camera-relative, not foul-line direction.${detail}`);
  } else if (Number.isFinite(directLa)) {
    parts.push(`Camera geometry gives about ${formatNumber(directLa, 0, " deg")} LA.`);
  }
  if (Number.isFinite(bestLa) && Number.isFinite(directLa) && Math.abs(bestLa - directLa) > 5) {
    parts.push(`The selected synthetic row is ${formatNumber(bestLa, 0, " deg")} because it better fits the marked endpoint distance and projected flight table; that mismatch is a signal to recheck early ball points, field landmarks, and endpoint distance.`);
  } else if (Number.isFinite(bestLa)) {
    parts.push(`The selected synthetic row is close at ${formatNumber(bestLa, 0, " deg")}.`);
  }
  return parts.join(" ");
}

function renderUncalibratedPathDiagnostic(target, prediction) {
  const best = practicalEstimate(prediction);
  if (!best) {
    target.textContent = "No path-shape diagnostic candidates.";
    return;
  }
  const clusterRange = displayedLikelyBands(best, summarizeBestCluster(prediction.ev_candidates, 5));
  const pathEvidence = prediction.projected_path_evidence || {};
  const apexEvidence = prediction.apex_evidence || {};
  const localApexEstimate = apexFrameEstimateFromLaunchAngle(best.launch_angle_deg);
  const apexText = localApexEstimate
    ? `${formatNumber(localApexEstimate.apexTimeS, 0, " s")} / ${formatNumber(localApexEstimate.apexHeightFt, 0, " ft")} / vertical ${formatNumber(localApexEstimate.verticalVelocityMph, 0, " mph")}`
    : apexEvidence.observed
    ? `${formatNumber(apexEvidence.relative_time_s, 0, " s")} (${escapeHtml(apexEvidence.confidence || "LOW")} confidence)`
    : `not used: ${escapeHtml(apexEvidence.reason || "no confirmed visible apex")}`;
  target.innerHTML = `
    <strong>Path-shape diagnostic: ${formatBestGuess(best, { prefix: "~", compact: true })}</strong>
    <dl>
      <dt>Status</dt><dd>${escapeHtml(prediction.identifiability?.reason || "camera geometry is not calibrated")}</dd>
      <dt>Important</dt><dd>${localApexEstimate ? "Ranked with the marked apex frame; still uncalibrated because field landmarks are missing." : "This is a synthetic path-shape comparison, not a calibrated physical EV/LA estimate."}</dd>
      <dt>Best diagnostic row</dt><dd>${escapeHtml(best.hit_id || "")}</dd>
      <dt>Pixel error</dt><dd>${formatNumber(best.pixel_rmse, 0, " px")}</dd>
      <dt>Path points used</dt><dd>${formatNumber(pathEvidence.used_count, 0, "", "not used")}</dd>
      <dt>Observed span</dt><dd>${formatNumber(pathEvidence.time_span_s, 0, " s", "not used")}</dd>
      <dt>Apex evidence</dt><dd>${apexText}</dd>
      <dt>Likely EV band</dt><dd>${formatRange(clusterRange?.ev_mph, " mph")}</dd>
      <dt>Likely LA band</dt><dd>${formatRange(clusterRange?.launch_angle_deg, " deg")}</dd>
      <dt>Likely distance band</dt><dd>${formatRange(clusterRange?.distance_ft, " ft")}</dd>
      <dt>Confidence</dt><dd>LOW: displayed band is a tight working estimate around the best match; broader ambiguity is kept out of the headline.</dd>
      <dt>Explanation</dt><dd>${escapeHtml(plainEstimateExplanation(best, prediction))}</dd>
      <dt>What would make it physical</dt><dd>field/camera calibration, confirmed apex height, ground-contact time, landing area, or another real-world scale constraint</dd>
    </dl>
  `;
}

function endpointMarkerDistanceFt() {
  const markerX = markers.landing.x * 3.6;
  const markerY = markers.landing.y * 4.2;
  const dx = markerX - 180.0;
  const dy = 316.0 - markerY;
  const radius = Math.hypot(dx, dy);
  return radius <= 1e-6 ? null : radius * (currentFieldProfile().fenceFt / 234.0);
}

function apexFrameEstimateFromLaunchAngle(launchAngleDeg) {
  if (!state.apexEvent || launchAngleDeg === null || launchAngleDeg === undefined) return null;
  const apexTimeS = Number(state.apexEvent.relative_time_s);
  const launchAngle = Number(launchAngleDeg);
  const sinLa = Math.sin((launchAngle * Math.PI) / 180);
  const tanLa = Math.tan((launchAngle * Math.PI) / 180);
  if (!Number.isFinite(apexTimeS) || apexTimeS <= 0 || !Number.isFinite(sinLa) || Math.abs(sinLa) < 1e-6) {
    return null;
  }
  const gFtS2 = 32.174;
  const startHeightFt = 2.5;
  const verticalVelocityFtS = gFtS2 * apexTimeS;
  const exitVelocityFtS = verticalVelocityFtS / sinLa;
  const landingTimeS = (verticalVelocityFtS + Math.sqrt(verticalVelocityFtS ** 2 + 2 * gFtS2 * startHeightFt)) / gFtS2;
  const horizontalVelocityFromLaFtS = Math.abs(tanLa) < 1e-6 ? null : verticalVelocityFtS / tanLa;
  const predictedDistanceFt = horizontalVelocityFromLaFtS === null ? null : horizontalVelocityFromLaFtS * landingTimeS;
  const endpointDistanceFt = endpointMarkerDistanceFt();
  const horizontalVelocityFromDistanceFtS = endpointDistanceFt === null ? null : endpointDistanceFt / landingTimeS;
  const distanceBasedEvFtS = horizontalVelocityFromDistanceFtS === null
    ? null
    : Math.hypot(horizontalVelocityFromDistanceFtS, verticalVelocityFtS);
  const distanceBasedLaunchAngleDeg = horizontalVelocityFromDistanceFtS === null
    ? null
    : (Math.atan2(verticalVelocityFtS, horizontalVelocityFromDistanceFtS) * 180) / Math.PI;
  const distanceErrorRatio = endpointDistanceFt === null || predictedDistanceFt === null
    ? null
    : Math.abs(predictedDistanceFt - endpointDistanceFt) / Math.max(endpointDistanceFt, 1);
  const apexHeightFt = startHeightFt + 0.5 * gFtS2 * apexTimeS * apexTimeS;
  return {
    apexTimeS,
    apexHeightFt,
    landingTimeS,
    launchAngleDeg: launchAngle,
    exitVelocityMph: exitVelocityFtS / 1.467,
    verticalVelocityMph: verticalVelocityFtS / 1.467,
    predictedDistanceFt,
    endpointDistanceFt,
    distanceErrorRatio,
    distanceConflict: distanceErrorRatio !== null && distanceErrorRatio > 0.35,
    distanceBasedEvMph: distanceBasedEvFtS === null ? null : distanceBasedEvFtS / 1.467,
    distanceBasedLaunchAngleDeg,
  };
}

function localApexEstimateMarkup(localApexEstimate, methodText, laEvidence, laRange, viewText, prediction, mode = "direct") {
  const weakDepthLaunchAngle = /depth_heavy|oblique/.test(String(viewText || ""))
    && String(laEvidence.confidence || "").toUpperCase() === "LOW";
  const heading = weakDepthLaunchAngle
    ? "Apex frame anchor"
    : `${formatBestGuess(localApexEstimate, { evKey: "exitVelocityMph", laKey: "launchAngleDeg", distanceKey: "predictedDistanceFt" })} from apex frame`;
  const launchAngleRow = weakDepthLaunchAngle
    ? `<dt>LA-only estimate</dt><dd>not used: ${formatBestGuess(localApexEstimate, { evKey: "exitVelocityMph", laKey: "launchAngleDeg", distanceKey: "predictedDistanceFt" })} would depend on a low-confidence depth-heavy LA</dd>`
    : `<dt>LA-only estimate</dt><dd>${formatBestGuess(localApexEstimate, { evKey: "exitVelocityMph", laKey: "launchAngleDeg", distanceKey: "predictedDistanceFt" })}</dd>`;
  return `
    <strong>${heading}</strong>
    <dl>
      <dt>Apex frame</dt><dd>${formatNumber(localApexEstimate.apexTimeS, 0, " s")} after contact</dd>
      <dt>Estimated apex height</dt><dd>${formatNumber(localApexEstimate.apexHeightFt, 0, " ft")}</dd>
      <dt>Vertical speed</dt><dd>${formatNumber(localApexEstimate.verticalVelocityMph, 0, " mph")}</dd>
      ${launchAngleRow}
      <dt>LA source</dt><dd>${escapeHtml(methodText)}</dd>
      ${mode === "direct" ? `<dt>LA confidence</dt><dd>${escapeHtml(laEvidence.confidence || "")}${laEvidence.reason ? `: ${escapeHtml(laEvidence.reason)}` : ""}</dd>` : ""}
      ${laRange ? `<dt>LA FOV range</dt><dd>${laRange}</dd>` : ""}
      <dt>View</dt><dd>${viewText}</dd>
      <dt>Spray</dt><dd>${formatNumber(prediction.field_direction?.spray_angle_deg, 0, " deg")} (${escapeHtml(prediction.field_direction?.source || "")})</dd>
      <dt>Note</dt><dd>${weakDepthLaunchAngle ? "Using the marked apex frame as the physical apex; depth-heavy image geometry does not move it earlier." : "Computed from the currently loaded apex frame and measured LA."}</dd>
    </dl>
  `;
}

function renderDirectPredictionCard(target, prediction) {
  if (prediction?.distance_review?.required) {
    target.innerHTML = `<strong>Review required  -  no accepted estimate</strong><p>${escapeHtml(prediction.distance_review.message)}</p>`;
    return;
  }
  if (prediction?.method === "uncalibrated_path_shape_diagnostic") {
    renderUncalibratedPathDiagnostic(target, prediction);
    return;
  }
  const best = practicalEstimate(prediction);
  if (!best) {
    target.textContent = "No direct-video EV candidates.";
    return;
  }
  if (prediction.method === 'distance_hang_constrained') {
    target.innerHTML = `<strong>~${formatNumber(best.exit_velocity_mph,1,' mph')} / ${formatNumber(best.launch_angle_deg,1,' deg')} / ${formatNumber(best.distance_ft,0,' ft')}</strong><p>Conditional distance-and-hang-time estimate. Hang time: ${formatNumber(best.hang_time_s,2,' s')}. Video alignment is reported separately and has not validated this estimate.</p>`;
    return;
  }
  const la = prediction.direct_launch_angle || {};
  const measuredLa = la.launch_angle_deg;
  const laRange = displayCameraLaRange(la);
  const fovText = la.horizontal_fov_deg === undefined ? "" : `${round(la.horizontal_fov_deg, 0)} deg FOV`;
  const methodText = prediction.direction_first_match?.angle_primary
    ? 'Calculated launch angle held fixed'
    : prediction.estimation_pipeline === 'early_geometry_then_late_height'
    ? (usesDescentRate(prediction)?'Early launch angle + later descent rate':prediction.direction_first_match?.late_evidence_policy==='timing_only'?'Early launch angle + later timing':'Early launch angle + later ball height')
    : prediction.estimation_pipeline === 'limited_early_flight_joint_fit'
    ? 'Early-flight estimate — no later height mark'
    : prediction.method === 'direction_first_shared_synthetic_match'
    ? (prediction.direction_first_match?.selection_policy ? 'video path and estimated distance' : 'shared synthetic flight direction')
    : la.method === "homography_decomposed_camera_pose_fov_sweep"
    ? `camera pose / FOV sweep${fovText ? ` (${fovText} selected)` : ""}`
    : "direct video geometry";
  const laEvidence = prediction.launch_angle_evidence || {};
  const cameraLaConfidence = String(laEvidence.confidence || "").toUpperCase();
  const apexEvidence = prediction.apex_evidence || {};
  const apexPhysics = prediction.apex_physics_estimate || null;
  const apexLaunch = prediction.apex_ballistic_launch_estimate || null;
  const localApexEstimate = cameraLaConfidence === "LOW" ? null : apexFrameEstimateFromLaunchAngle(measuredLa);
  const apexText = localApexEstimate
    ? `${formatNumber(localApexEstimate.apexTimeS, 0, " s")} / ${formatNumber(localApexEstimate.apexHeightFt, 0, " ft")} / vertical ${formatNumber(localApexEstimate.verticalVelocityMph, 0, " mph")}`
    : apexLaunch
    ? `${formatNumber(apexLaunch.apex_time_s || apexPhysics?.apex_time_s, 0, " s")} / ${formatNumber(apexLaunch.apex_height_ft || apexPhysics?.apex_height_ft, 0, " ft")} -> ${formatNumber(apexLaunch.exit_velocity_mph, 0, " mph")} EV / ${formatNumber(apexLaunch.launch_angle_deg, 0, " deg")} LA`
    : apexPhysics
      ? `${formatNumber(apexPhysics.apex_time_s, 0, " s")} / ${formatNumber(apexPhysics.apex_height_ft, 0, " ft")} / vertical ${formatNumber(apexPhysics.vertical_velocity_mph, 0, " mph")}`
    : apexEvidence.observed === false
      ? `not used: ${escapeHtml(apexEvidence.reason || "no clear apex")}`
      : "not supplied";
  const viewText = prediction.view_geometry?.classification
    ? `${escapeHtml(prediction.view_geometry.classification)} (${escapeHtml(prediction.view_geometry.reason || "")})`
    : "not classified";
  const hasApexAnchor = Boolean(localApexEstimate || apexPhysics || apexLaunch || apexEvidence.observed);
  if (best.ev_underconstrained && !hasApexAnchor) {
    const ident = prediction.identifiability || {};
    target.innerHTML = `
      <strong>${formatNumber(measuredLa, 0, " deg LA", "LA not available")} / ${formatNumber(best.distance_ft, 0, " ft", "distance not available")} / EV underconstrained</strong>
      <dl>
        <dt>Why</dt><dd>${escapeHtml(ident.reason || "No numeric distance estimate and ground contact is not HIGH confidence.")}</dd>
        <dt>LA source</dt><dd>${escapeHtml(methodText)}</dd>
        <dt>LA confidence</dt><dd>${escapeHtml(laEvidence.confidence || "")}${laEvidence.reason ? `: ${escapeHtml(laEvidence.reason)}` : ""}</dd>
        ${laRange ? `<dt>LA FOV range</dt><dd>${laRange}</dd>` : ""}
        <dt>View</dt><dd>${viewText}</dd>
        <dt>Apex anchor</dt><dd>${apexText}</dd>
        <dt>Spray</dt><dd>${formatNumber(prediction.field_direction?.spray_angle_deg, 0, " deg")} (${escapeHtml(prediction.field_direction?.source || "")})</dd>
        <dt>Path-only model</dt><dd>${escapeHtml(pathOnlyModelText(prediction))}</dd>
        <dt>EV ranking</dt><dd>disabled until apex time/height, distance, or HIGH-confidence hang evidence exists</dd>
      </dl>
    `;
    return;
  }
  const range = displayedLikelyBands(best, summarizeBestCluster(prediction.ev_candidates, 5));
  const ident = prediction.identifiability || {};
  const syntheticFit = syntheticFitText(best, prediction);
  const estimateConfidence = estimateConfidenceText(best, prediction);
  const evRange = range?.ev_mph;
  const flightLaRange = range?.launch_angle_deg;
  const distanceRange = range?.distance_ft;
  const hangRange = range?.hang_time_s;
  const timingEvidence = prediction.direction_first_match?.hang_time_evidence;
  target.innerHTML = `
    <strong>${formatBestGuess(best)}</strong>
    <p>${escapeHtml(estimateConfidence)}</p>
    <section class="prediction-technical-details"><button type="button" data-ev-technical-toggle aria-expanded="false">Technical details</button>
    <div data-ev-technical-panel hidden>
    <dl>
      <dt>Why this flight was selected</dt><dd>${usesDescentRate(prediction)?'Speed balances the camera-corrected descent rate, early geometry and landing allowance. Absolute later height and horizontal position are excluded.':prediction.direction_first_match?.angle_primary ? 'Its calculated launch angle is held fixed. Speed is selected using the video evidence and landing-distance allowance; distance cannot change the launch angle.' : prediction.estimation_pipeline === 'early_geometry_then_late_height' ? 'Its launch angle comes from the early marks, its speed from later rise/descent timing and its landing distance is within your allowance.' : `Its calculated ball positions and landing distance agree with your selections, allowing +/-${landingDirectionAllowance(prediction)} deg around the mapped direction.`}</dd>
      ${usesDescentRate(prediction)?`<dt>Descent rate</dt><dd>${formatNumber(prediction.direction_first_match.late_descent_rate.observed_rate_px_per_s,1,' px/s')} observed; ${formatNumber(best.predicted_descent_rate_px_per_s,1,' px/s')} modeled. Comparison allowance: ±${formatNumber(prediction.direction_first_match.late_descent_rate.rate_allowance_px_per_s*prediction.direction_first_match.late_descent_rate.acceptance_multiplier,1,' px/s')}, after camera correction.</dd>`:''}
      ${prediction.direction_first_match?.late_descent_rate && !usesDescentRate(prediction)?`<dt>Descent rate</dt><dd>Not used: ${escapeHtml(prediction.direction_first_match.late_descent_rate.reason||'No reliable descent sequence.')}</dd>`:''}
      ${prediction.video_only_support?.exit_velocity_mph?`<dt>Video-only allowed range</dt><dd>${formatRange(prediction.video_only_support.exit_velocity_mph,' mph')}; excludes the landing estimate.</dd>`:''}
      <dt>Difference from selected ball positions</dt><dd>${formatNumber(best.projected_path_rmse_px, 1, " px RMS")}</dd>
      ${timingEvidence?.landing_time_s != null ? `<dt>Hang time</dt><dd>${formatNumber(best.hang_time_s, 2, " s")} modeled; ${formatNumber(timingEvidence.landing_time_s, 2, " s")} marked, +/-${formatNumber(timingEvidence.tolerance_s, 2, " s")}.</dd>` : ""}
      <dt>Ignoring entered distance</dt><dd>${escapeHtml(pathOnlyModelText(prediction))}</dd>
      <dt>Comparison limits</dt><dd>Uses the same camera calibration and mapped direction.</dd>
    </dl>
    </div></section>
  `;
}

let technicalPanelSequence=0;
document.addEventListener('click',event=>{
  const button=event.target.closest?.('[data-ev-technical-toggle]');
  if(!button)return;
  const panel=button.closest('.prediction-technical-details')?.querySelector('[data-ev-technical-panel]');
  if(!panel)return;
  if(!panel.id)panel.id=`ev-technical-panel-${++technicalPanelSequence}`;
  button.setAttribute('aria-controls',panel.id);
  panel.hidden=!panel.hidden;
  button.setAttribute('aria-expanded',String(!panel.hidden));
},true);

function renderEvidenceWarnings(prediction) {
  if (!els.predictionWarning) return;
  const blocker = predictionExportBlocker(prediction);
  const warnings = Array.isArray(prediction?.evidence_warnings)
    ? prediction.evidence_warnings
    : [];
  if (blocker) {
    const actionText = Array.isArray(blocker.actions) && blocker.actions.length
      ? blocker.actions.join(" ")
      : "Correct the marks, then rebuild the prediction.";
    els.predictionWarning.hidden = false;
    els.predictionWarning.classList.add("is-strong");
    els.predictionWarning.innerHTML = `
      <strong>${escapeHtml(blocker.title || "Export paused")}</strong>
      <p>${escapeHtml(blocker.message || "The marked evidence does not reconcile cleanly enough to export.")}</p>
      <small>${escapeHtml(actionText)}</small>
    `;
    return;
  }
  if (!warnings.length) {
    els.predictionWarning.hidden = true;
    els.predictionWarning.innerHTML = "";
    els.predictionWarning.classList.remove("is-strong");
    return;
  }
  const primary = warnings.find((warning) => warning.severity === "strong") || warnings[0];
  const moreCount = Math.max(0, warnings.length - 1);
  els.predictionWarning.hidden = false;
  els.predictionWarning.classList.toggle("is-strong", primary.severity === "strong");
  els.predictionWarning.innerHTML = `
    <strong>${escapeHtml(primary.title || "Evidence mismatch")}</strong>
    <p>${escapeHtml(primary.message || "The marks do not reconcile cleanly with the selected synthetic flight.")}</p>
    ${moreCount ? `<small>${moreCount} more conflict${moreCount === 1 ? "" : "s"} found in the prediction details.</small>` : ""}
  `;
}

function predictionExportBlocker(prediction = state.latestPrediction) {
  if (prediction?.distance_review?.required) return prediction.distance_review;
  const readiness = prediction?.export_readiness;
  if (!readiness || readiness.allowed !== false) return null;
  return readiness;
}

function exportReadinessMarkup(prediction = state.latestPrediction) {
  const blocker = predictionExportBlocker(prediction);
  if (!blocker) return "";
  const actionText = Array.isArray(blocker.actions) && blocker.actions.length
    ? blocker.actions.join(" ")
    : "Correct the marks, then rebuild the prediction.";
  return `
    <div class="workflow-warning">
      <strong>${escapeHtml(blocker.title || "Export paused")}</strong>
      <p>${escapeHtml(blocker.message || "The marked evidence does not reconcile cleanly enough to export.")}</p>
      <small>${escapeHtml(actionText)}</small>
    </div>
  `;
}

function renderPredictionCard(target, summary) {
  const best = summary?.top?.[0];
  if (!best) {
    target.textContent = "No matching candidates.";
    return;
  }
  const range = displayedLikelyBands(best, summarizeBestCluster(summary.top, 5));
  target.innerHTML = `
    <strong>${formatNumber(best.exit_velocity_mph, 0, " mph")} / ${formatNumber(best.launch_angle_deg, 0, " deg")} / ${formatNumber(best.distance_ft, 0, " ft")}</strong>
    <dl>
      <dt>Best fit</dt><dd>${escapeHtml(best.hit_id)}</dd>
      <dt>Pixel error</dt><dd>${formatNumber(best.pixel_rmse, 0, " px")}</dd>
      <dt>Hangtime</dt><dd>${formatNumber(best.hang_time_s, 0, " s", "")}</dd>
      <dt>Likely EV band</dt><dd>${formatRange(range?.ev_mph, " mph")}</dd>
      <dt>Likely LA band</dt><dd>${formatRange(range?.launch_angle_deg, " deg")}</dd>
      <dt>Likely distance band</dt><dd>${formatRange(range?.distance_ft, " ft")}</dd>
      <dt>Likely hangtime band</dt><dd>${formatRange(range?.hang_time_s, " s")}</dd>
      <dt>Note</dt><dd>Displayed bands are tight working estimates around the best match, not the full theoretical ambiguity range.</dd>
    </dl>
  `;
}

function bestPredictionRow(prediction = state.latestPrediction) {
  if (!prediction) return null;
  if (prediction.distance_review?.required) return null;
  const practical = practicalEstimate(prediction);
  if (practical) return practical;
  if (prediction.ev_candidates?.length) return prediction.ev_candidates[0];
  if (prediction.unconstrained?.top?.length) return prediction.unconstrained.top[0];
  return null;
}

function flightPathSamples(best, prediction = state.latestPrediction) {
  if (!best) return [];
  const distanceFt = Number(best.distance_ft);
  const hangTimeS = Number(best.hang_time_s);
  const apexFt = Number(best.apex_ft);
  const apexTimeS = Number(best.apex_time_s);
  const sprayDeg = Number(best.spray_angle_deg ?? prediction?.field_direction?.spray_angle_deg ?? 0);
  if (!Number.isFinite(distanceFt) || !Number.isFinite(hangTimeS) || hangTimeS <= 0) return [];
  const startHeightFt = 2.5;
  const sprayRad = (sprayDeg * Math.PI) / 180;
  const samples = [];
  for (let i = 0; i <= 72; i += 1) {
    const t = (hangTimeS * i) / 72;
    const u = t / hangTimeS;
    const downrange = distanceFt * u;
    let height;
    if (Number.isFinite(apexFt) && Number.isFinite(apexTimeS) && apexTimeS > 0 && apexTimeS < hangTimeS) {
      if (t <= apexTimeS) {
        const a = t / apexTimeS;
        height = startHeightFt + (apexFt - startHeightFt) * (2 * a - a * a);
      } else {
        const a = (t - apexTimeS) / (hangTimeS - apexTimeS);
        height = apexFt * (1 - a * a);
      }
    } else {
      height = Math.max(0, 4 * (apexFt || 30) * u * (1 - u));
    }
    samples.push({
      t,
      x: Math.sin(sprayRad) * downrange,
      y: Math.cos(sprayRad) * downrange,
      z: Math.max(0, height),
      downrange,
    });
  }
  return samples;
}

function pathFromPoints(points) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${round(point.x, 1)} ${round(point.y, 1)}`).join(" ");
}

function projectFlightWorld(point, scale, originX, originY) {
  const yaw = state.flightView.yaw;
  const pitch = state.flightView.pitch;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const xr = point.x * cosYaw - point.y * sinYaw;
  const yr = point.x * sinYaw + point.y * cosYaw;
  const screenYWorld = yr * Math.sin(pitch) + (point.z || 0) * Math.cos(pitch);
  return {
    x: originX + xr * scale,
    y: originY - screenYWorld * scale,
  };
}

function radialPoints(radiusFt, startDeg = -45, endDeg = 45, stepDeg = 2.5) {
  const points = [];
  for (let deg = startDeg; deg <= endDeg + 0.001; deg += stepDeg) {
    points.push({
      x: Math.sin((deg * Math.PI) / 180) * radiusFt,
      y: Math.cos((deg * Math.PI) / 180) * radiusFt,
      z: 0,
    });
  }
  return points;
}

function baseDiamondPoints() {
  const baseFt = currentFieldProfile().baseFt;
  const offset = baseFt / Math.SQRT2;
  return [
    { x: 0, y: 0, z: 0 },
    { x: offset, y: offset, z: 0 },
    { x: 0, y: baseFt * Math.SQRT2, z: 0 },
    { x: -offset, y: offset, z: 0 },
    { x: 0, y: 0, z: 0 },
  ];
}

function fitFlightProjection(worldPointGroups) {
  const projected = worldPointGroups.flat().map((point) => projectFlightWorld(point, 1, 0, 0));
  const minX = Math.min(...projected.map((point) => point.x));
  const maxX = Math.max(...projected.map((point) => point.x));
  const minY = Math.min(...projected.map((point) => point.y));
  const maxY = Math.max(...projected.map((point) => point.y));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const scale = Math.min(650 / width, 330 / height) * state.flightView.zoom;
  return {
    scale,
    originX: 360 - ((minX + maxX) / 2) * scale + state.flightView.panX,
    originY: 228 - ((minY + maxY) / 2) * scale + state.flightView.panY,
  };
}

function renderFlightView() {
  const best = bestPredictionRow();
  if (!best || !els.flightSvg) return;
  const samples = flightPathSamples(best);
  if (!samples.length) {
    els.flightSvg.innerHTML = `<text x="24" y="48" class="flight-label">No flight row loaded.</text>`;
    return;
  }
  const distanceFt = Number(best.distance_ft);
  const apexFt = Number(best.apex_ft);
  const apexTimeS = Number(best.apex_time_s);
  const sprayDeg = Number(best.spray_angle_deg ?? state.latestPrediction?.field_direction?.spray_angle_deg ?? 0);
  const field = currentFieldProfile();
  const rangeRings = field.rings.map((ft) => radialPoints(ft));
  const leftFoulWorld = { x: Math.sin((-45 * Math.PI) / 180) * field.guideFt, y: Math.cos((-45 * Math.PI) / 180) * field.guideFt, z: 0 };
  const rightFoulWorld = { x: Math.sin((45 * Math.PI) / 180) * field.guideFt, y: Math.cos((45 * Math.PI) / 180) * field.guideFt, z: 0 };
  const centerWorld = { x: 0, y: field.guideFt, z: 0 };
  const diamond = baseDiamondPoints();
  const fit = fitFlightProjection([
    ...rangeRings,
    [leftFoulWorld, rightFoulWorld, centerWorld, { x: 0, y: 0, z: 0 }],
    diamond,
    samples,
  ]);
  const { scale, originX, originY } = fit;
  const project = (point) => projectFlightWorld(point, scale, originX, originY);
  const projected = samples.map(project);
  const flightPath = pathFromPoints(projected);
  const apexIndex = samples.reduce((bestIdx, point, idx) => point.z > samples[bestIdx].z ? idx : bestIdx, 0);
  const apexPoint = projected[apexIndex];
  const endPoint = projected[projected.length - 1];
  const groundPath = pathFromPoints(samples.map((point) => project({ ...point, z: 0 })));
  const rings = field.rings.map((ft, index) => {
    const label = project({ x: 0, y: ft, z: 0 });
    return `<path class="flight-range-ring" d="${pathFromPoints(rangeRings[index].map(project))}"></path><text x="${label.x + 6}" y="${label.y + 14}" class="flight-small-label">${ft} ft</text>`;
  }).join("");
  const home = project({ x: 0, y: 0, z: 0 });
  const leftFoul = project(leftFoulWorld);
  const rightFoul = project(rightFoulWorld);
  const center = project(centerWorld);
  const sprayEnd = project({ ...samples[samples.length - 1], z: 0 });
  const baseOffset = field.baseFt / Math.SQRT2;
  const first = project({ x: baseOffset, y: baseOffset, z: 0 });
  const second = project({ x: 0, y: field.baseFt * Math.SQRT2, z: 0 });
  const third = project({ x: -baseOffset, y: baseOffset, z: 0 });
  const diamondPath = pathFromPoints(diamond.map(project));
  els.flightSvg.innerHTML = `
    <rect x="0" y="0" width="720" height="420" fill="transparent"></rect>
    <g>
      <path d="M${home.x} ${home.y} L${leftFoul.x} ${leftFoul.y} M${home.x} ${home.y} L${rightFoul.x} ${rightFoul.y}" class="flight-foul"></path>
      ${rings}
      <path d="${diamondPath}" class="flight-infield"></path>
      <circle cx="${home.x}" cy="${home.y}" r="4" class="flight-base"></circle>
      <circle cx="${first.x}" cy="${first.y}" r="4" class="flight-base"></circle>
      <circle cx="${second.x}" cy="${second.y}" r="4" class="flight-base"></circle>
      <circle cx="${third.x}" cy="${third.y}" r="4" class="flight-base"></circle>
      <path d="M${home.x} ${home.y} L${sprayEnd.x} ${sprayEnd.y}" class="flight-spray"></path>
      <path class="flight-shadow" d="${groundPath}"></path>
      <path class="flight-path" d="${flightPath}"></path>
      <circle cx="${projected[0].x}" cy="${projected[0].y}" r="5" class="flight-ball"></circle>
      <circle cx="${apexPoint.x}" cy="${apexPoint.y}" r="6" fill="#ef4444" stroke="#ffffff" stroke-width="2"></circle>
      <circle cx="${endPoint.x}" cy="${endPoint.y}" r="5" fill="#165dff"></circle>
      <text x="${center.x - 8}" y="${center.y + 16}" class="flight-small-label">CF</text>
      <text x="${leftFoul.x + 8}" y="${leftFoul.y + 16}" class="flight-small-label">LF line</text>
      <text x="${rightFoul.x - 42}" y="${rightFoul.y + 16}" class="flight-small-label">RF line</text>
      <text x="${apexPoint.x + 10}" y="${apexPoint.y - 12}" class="flight-small-label">apex ${formatNumber(apexFt, 0, " ft")} @ ${formatNumber(apexTimeS, 0, " s")}</text>
      <text x="${endPoint.x - 42}" y="${endPoint.y + 22}" class="flight-small-label">${formatNumber(distanceFt, 0, " ft")}</text>
    </g>
  `;
}

function showFlightView() {
  if (!bestPredictionRow()) return;
  state.flightView.visible = true;
  els.flightViewer.hidden = false;
  els.resetFlightView.hidden = false;
  renderFlightView();
}

function resetFlightView() {
  state.flightView.zoom = 1;
  state.flightView.panX = 0;
  state.flightView.panY = 0;
  state.flightView.yaw = 0;
  state.flightView.pitch = 1.05;
  renderFlightView();
}

function flightCanvasContext() {
  const canvas = els.flightCanvas;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { context, width: rect.width, height: rect.height };
}

function fieldMarkerPercentToWorld(marker) {
  const markerX = Number(marker?.x ?? 50) * 3.6;
  const markerY = Number(marker?.y ?? 50) * 4.2;
  const scaleFtPerSvgUnit = currentFieldProfile().fenceFt / 234;
  return {
    x: (markerX - 180) * scaleFtPerSvgUnit,
    y: (316 - markerY) * scaleFtPerSvgUnit,
    z: 0,
  };
}

function setFlightPreset(name) {
  const view = state.flightView;
  view.panX = 0;
  view.panY = 0;
  view.zoom = 1;
  view.roll = 0;
  if (name === "video") {
    const camera = fieldMarkerPercentToWorld(markers.camera);
    const best = bestPredictionRow();
    const samples = flightPathSamples(best);
    const target = samples.length
      ? samples[Math.min(samples.length - 1, Math.max(0, Math.round(samples.length * 0.42)))]
      : fieldMarkerPercentToWorld(markers.landing);
    const dx = target.x - camera.x;
    const dy = target.y - camera.y;
    view.yaw = Math.atan2(dx, dy);
    view.pitch = 0.58;
    const height = Number(els.cameraHeightFt?.value || 6);
    if (Number.isFinite(height)) view.pitch = Math.max(0.38, Math.min(0.92, 0.5 + height / 120));
  } else if (name === "top") {
    view.yaw = 0;
    view.pitch = 1.565;
  } else if (name === "side") {
    view.yaw = Math.PI / 2;
    view.pitch = 0.62;
  } else if (name === "behind") {
    view.yaw = 0;
    view.pitch = 0.58;
  }
  renderFlightView();
}

function projectFlightPoint3d(point, scale, originX, originY) {
  const view = state.flightView;
  const yaw = view.yaw;
  const pitch = view.pitch;
  const roll = view.roll;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const cosRoll = Math.cos(roll);
  const sinRoll = Math.sin(roll);
  const xr = point.x * cosYaw - point.y * sinYaw;
  const yr = point.x * sinYaw + point.y * cosYaw;
  const zr = point.z || 0;
  const viewX = xr;
  const viewY = yr * sinPitch + zr * cosPitch;
  const depth = yr * cosPitch - zr * sinPitch;
  const rolledX = viewX * cosRoll - viewY * sinRoll;
  const rolledY = viewX * sinRoll + viewY * cosRoll;
  const perspective = 1 / Math.max(0.42, 1 + depth / 900);
  return {
    x: originX + rolledX * scale * perspective,
    y: originY - rolledY * scale * perspective,
    depth,
    perspective,
  };
}

function fitFlightCanvasProjection(groups, width, height) {
  const projected = groups.flat().map((point) => projectFlightPoint3d(point, 1, 0, 0));
  const minX = Math.min(...projected.map((point) => point.x));
  const maxX = Math.max(...projected.map((point) => point.x));
  const minY = Math.min(...projected.map((point) => point.y));
  const maxY = Math.max(...projected.map((point) => point.y));
  const worldWidth = Math.max(1, maxX - minX);
  const worldHeight = Math.max(1, maxY - minY);
  const scale = Math.min((width - 54) / worldWidth, (height - 104) / worldHeight) * state.flightView.zoom;
  return {
    scale,
    originX: width / 2 - ((minX + maxX) / 2) * scale + state.flightView.panX,
    originY: height / 2 + 16 - ((minY + maxY) / 2) * scale + state.flightView.panY,
  };
}

function drawFlightPath(context, points, project, style = {}) {
  if (!points.length) return;
  context.save();
  context.beginPath();
  points.forEach((point, index) => {
    const projected = project(point);
    if (index === 0) context.moveTo(projected.x, projected.y);
    else context.lineTo(projected.x, projected.y);
  });
  context.strokeStyle = style.stroke || "#1d4ed8";
  context.lineWidth = style.lineWidth || 3;
  context.setLineDash(style.dash || []);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.stroke();
  context.restore();
}

function drawFlightLabel(context, text, x, y, fill = "#172026") {
  context.save();
  context.fillStyle = fill;
  context.font = "700 12px Inter, Segoe UI, sans-serif";
  context.fillText(text, x, y);
  context.restore();
}

function interpolatedFlightPoint(samples, time01) {
  if (!samples.length) return null;
  if (time01 <= 0) return samples[0];
  if (time01 >= 1) return samples[samples.length - 1];
  const scaled = time01 * (samples.length - 1);
  const index = Math.floor(scaled);
  const mix = scaled - index;
  const a = samples[index];
  const b = samples[Math.min(samples.length - 1, index + 1)];
  return {
    t: a.t + (b.t - a.t) * mix,
    x: a.x + (b.x - a.x) * mix,
    y: a.y + (b.y - a.y) * mix,
    z: a.z + (b.z - a.z) * mix,
  };
}

function renderFlightView() {
  const best = bestPredictionRow();
  const canvasState = flightCanvasContext();
  if (!canvasState) return;
  const { context, width, height } = canvasState;
  context.clearRect(0, 0, width, height);
  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#dceaf0");
  sky.addColorStop(0.48, "#cfe2d0");
  sky.addColorStop(1, "#74b86b");
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);
  if (!best) {
    if (els.flightHud) els.flightHud.textContent = "Load Prediction to simulate the matched record.";
    return;
  }
  const samples = flightPathSamples(best);
  if (!samples.length) {
    if (els.flightHud) els.flightHud.textContent = "No matched flight row has enough data to simulate.";
    return;
  }

  const field = currentFieldProfile();
  const rangeRings = field.rings.map((ft) => radialPoints(ft));
  const leftFoulWorld = { x: Math.sin((-45 * Math.PI) / 180) * field.guideFt, y: Math.cos((-45 * Math.PI) / 180) * field.guideFt, z: 0 };
  const rightFoulWorld = { x: Math.sin((45 * Math.PI) / 180) * field.guideFt, y: Math.cos((45 * Math.PI) / 180) * field.guideFt, z: 0 };
  const centerWorld = { x: 0, y: field.guideFt, z: 0 };
  const diamond = baseDiamondPoints();
  const fit = fitFlightCanvasProjection([
    ...rangeRings,
    [leftFoulWorld, rightFoulWorld, centerWorld, { x: 0, y: 0, z: 0 }],
    diamond,
    samples,
  ], width, height);
  const project = (point) => projectFlightPoint3d(point, fit.scale, fit.originX, fit.originY);
  const home = project({ x: 0, y: 0, z: 0 });
  const leftFoul = project(leftFoulWorld);
  const rightFoul = project(rightFoulWorld);
  const center = project(centerWorld);

  rangeRings.forEach((ring, index) => {
    drawFlightPath(context, ring, project, { stroke: "rgb(255 255 255 / 0.45)", lineWidth: 1, dash: [5, 7] });
    const distance = field.rings[index];
    const label = project({ x: 0, y: distance, z: 0 });
    drawFlightLabel(context, `${distance} ft`, label.x + 6, label.y + 12, "#4b5a64");
  });
  drawFlightPath(context, [{ x: 0, y: 0, z: 0 }, leftFoulWorld], project, { stroke: "#f8fafc", lineWidth: 2.5 });
  drawFlightPath(context, [{ x: 0, y: 0, z: 0 }, rightFoulWorld], project, { stroke: "#f8fafc", lineWidth: 2.5 });
  drawFlightPath(context, diamond, project, { stroke: "#965137", lineWidth: 2 });
  drawFlightPath(context, samples.map((point) => ({ ...point, z: 0 })), project, { stroke: "rgb(23 32 38 / 0.34)", lineWidth: 2, dash: [7, 7] });

  const groundEnd = project({ ...samples[samples.length - 1], z: 0 });
  drawFlightPath(context, [{ x: 0, y: 0, z: 0 }, { ...samples[samples.length - 1], z: 0 }], project, { stroke: "rgb(23 32 38 / 0.34)", lineWidth: 2, dash: [8, 8] });
  drawFlightPath(context, samples, project, { stroke: "#1d4ed8", lineWidth: 4 });

  const apexIndex = samples.reduce((bestIdx, point, idx) => point.z > samples[bestIdx].z ? idx : bestIdx, 0);
  const progressIndex = Math.max(1, Math.min(samples.length - 1, Math.round(state.flightView.time * (samples.length - 1))));
  drawFlightPath(context, samples.slice(0, progressIndex + 1), project, { stroke: "#ef4444", lineWidth: 6 });
  const apex = project(samples[apexIndex]);
  const ball = project(interpolatedFlightPoint(samples, state.flightView.time));
  const start = project(samples[0]);
  const end = project(samples[samples.length - 1]);
  const bases = [
    { x: 0, y: 0, z: 0 },
    { x: field.baseFt / Math.SQRT2, y: field.baseFt / Math.SQRT2, z: 0 },
    { x: 0, y: field.baseFt * Math.SQRT2, z: 0 },
    { x: -field.baseFt / Math.SQRT2, y: field.baseFt / Math.SQRT2, z: 0 },
  ].map(project);

  context.save();
  context.fillStyle = "#fff";
  context.strokeStyle = "#59666f";
  bases.forEach((base) => {
    context.beginPath();
    context.arc(base.x, base.y, 4, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  });
  context.fillStyle = "#ef4444";
  context.strokeStyle = "#fff";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(apex.x, apex.y, 6, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = "#165dff";
  context.beginPath();
  context.arc(end.x, end.y, 5, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgb(23 32 38 / 0.22)";
  context.beginPath();
  context.ellipse(groundEnd.x, groundEnd.y, 12, 5, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#ffffff";
  context.strokeStyle = "#b91c1c";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(ball.x, ball.y, Math.max(7, 10 * ball.perspective), 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.restore();

  const sprayDeg = Number(best.spray_angle_deg ?? state.latestPrediction?.field_direction?.spray_angle_deg ?? 0);
  const view = state.flightView;
  const timeS = samples[samples.length - 1].t * state.flightView.time;
  if (els.flightHud) {
    els.flightHud.textContent = `${formatNumber(best.exit_velocity_mph, 0, " mph")} / ${formatNumber(best.launch_angle_deg, 0, " degrees")} / ${formatNumber(best.distance_ft, 0, " feet")}  |  spray ${formatNumber(sprayDeg, 0, " degrees")}  |  t=${formatNumber(timeS, 1, " s")}  |  yaw ${formatNumber(view.yaw * 180 / Math.PI, 0, " degrees")} tilt ${formatNumber(view.pitch * 180 / Math.PI, 0, " degrees")} roll ${formatNumber(view.roll * 180 / Math.PI, 0, " degrees")}`;
  }
  drawFlightLabel(context, "CF", center.x - 8, center.y + 15, "#4b5a64");
  drawFlightLabel(context, "LF line", leftFoul.x + 8, leftFoul.y + 15, "#4b5a64");
  drawFlightLabel(context, "RF line", rightFoul.x - 44, rightFoul.y + 15, "#4b5a64");
  drawFlightLabel(context, `apex ${formatNumber(samples[apexIndex].z, 0, " ft")}`, apex.x + 10, apex.y - 10, "#172026");
  drawFlightLabel(context, `${formatNumber(best.distance_ft, 0, " ft")}`, end.x - 22, end.y + 22, "#172026");
  drawFlightLabel(context, "drag = rotate/tilt, shift-drag = twist, wheel = zoom", 16, height - 58, "#172026");

  if (els.flightTime) els.flightTime.value = String(state.flightView.time);
}

function animateFlightView(now = performance.now()) {
  if (!state.flightView.playing) return;
  const last = state.flightView.lastAnimationTime || now;
  const deltaS = Math.min(0.08, Math.max(0, (now - last) / 1000));
  state.flightView.lastAnimationTime = now;
  state.flightView.time += deltaS / 3.6;
  if (state.flightView.time > 1) state.flightView.time = 0;
  renderFlightView();
  state.flightView.animationFrame = requestAnimationFrame(animateFlightView);
}

function setFlightPlaying(playing) {
  state.flightView.playing = !!playing;
  if (els.flightPlay) els.flightPlay.textContent = state.flightView.playing ? "Pause" : "Play";
  if (state.flightView.playing) {
    state.flightView.lastAnimationTime = performance.now();
    cancelAnimationFrame(state.flightView.animationFrame);
    state.flightView.animationFrame = requestAnimationFrame(animateFlightView);
  } else {
    cancelAnimationFrame(state.flightView.animationFrame);
    state.flightView.animationFrame = null;
  }
}

function showFlightView() {
  if (!bestPredictionRow()) return;
  state.flightView.visible = true;
  els.flightViewer.hidden = false;
  els.resetFlightView.hidden = false;
  setFlightPreset("video");
  renderFlightView();
}

function resetFlightView() {
  state.flightView.time = 0;
  setFlightPlaying(false);
  setFlightPreset("video");
}

function openPredictionModal() {
  if (!els.predictionModal) return;
  if (typeof els.predictionModal.showModal === "function" && !els.predictionModal.open) {
    els.predictionModal.showModal();
  } else {
    els.predictionModal.setAttribute("open", "");
  }
  requestAnimationFrame(renderFlightView);
}

function closePredictionModal() {
  if (!els.predictionModal?.open) return;
  if (typeof els.predictionModal.close === "function") els.predictionModal.close();
  else els.predictionModal.removeAttribute("open");
}

const earlyEstimatePreparation=window.GameFrameEstimatePreparation?.createEstimatePreparation((...args)=>fetch(...args));
const earlyRegistrationPreparation=window.GameFrameEstimatePreparation?.createEstimatePreparation((...args)=>fetch(...args));
let earlyEstimateTimer=null;
function estimatePreparationKeys(pkg){
  const camera=pkg.camera||{},distance=pkg.hit?.distance_observation||{},meta=pkg.video_metadata||{};
  const fieldMarks=(pkg.landmarks||[]).map(row=>[row.landmark,row.image_x,row.image_y,row.uncertainty_px,row.estimate_kind??null,row.rubber_visible??null]).sort((a,b)=>a[0].localeCompare(b[0]));
  const evidence=JSON.stringify([meta.file_name,meta.source_path,meta.width_px,meta.height_px,
    meta.frame_step_assumption_s,meta.timing_source,meta.variable_frame_rate,
    camera.field_xy_ft,camera.height_ft,camera.position_uncertainty_ft,camera.height_uncertainty_ft,
    pkg.field,fieldMarks,pkg.hit?.contact,pkg.ball_observations,
    distance.spray_angle_deg,pkg.hit?.direction_observation]);
  return {evidence,request:JSON.stringify([evidence,distance.distance_ft,distance.uncertainty_ft,pkg.terminal_event])};
}
function scheduleEarlyEstimatePreparation(){
  clearTimeout(earlyEstimateTimer);
  earlyEstimateTimer=setTimeout(()=>{
    if(!earlyEstimatePreparation)return;
    if(!els.setupModal?.open || state.contactTime===null || state.observations.length<2){
      earlyEstimatePreparation.cancel();earlyRegistrationPreparation?.cancel();return;
    }
    if(state.latestPrediction || backgroundPredictionPromise || livePredictionController)return;
    const pkg=buildPackage();
    if(state.detectionAccepted || state.ballAssistAccepted){
      const meta=pkg.video_metadata;
      const registrationKey=JSON.stringify([meta.file_name,meta.source_path,meta.width_px,meta.height_px,
        meta.variable_frame_rate,meta.timing_source,pkg.ball_observations]);
      void earlyRegistrationPreparation?.prepare(registrationKey,registrationKey,{...pkg,_prepare_background_only:true});
    }
    // Speculative work never commits suggestions. Acceptance can reuse it
    // only when the actual marker coordinates and uncertainties still match.
    if(activeWorkflowStep==='landmarks' && state.pendingLandmarks.length){
      const marks=new Map(pkg.landmarks.map(row=>[row.landmark,row]));
      for(const row of state.pendingLandmarks)marks.set(row.landmark,row);
      pkg.landmarks=[...marks.values()];
    }
    const fieldReady=LANDMARK_SEQUENCE.every(name=>pkg.landmarks.some(row=>row.landmark===name && row.image_x!==null && row.image_y!==null) || state.skippedVideoMarks?.includes(`field:${name}`));
    if(!fieldReady || !actualFieldMapGeometryReady()){earlyEstimatePreparation.cancel();return;}
    const keys=estimatePreparationKeys(pkg);
    void earlyEstimatePreparation.prepare(keys.evidence,keys.request,pkg);
  },450);
}

function markPredictionStale() {
  scheduleEarlyEstimatePreparation();
  preparedClipBuild = null;
  const hadBackgroundPrediction = Boolean(backgroundPredictionPromise || backgroundPredictionAbortController);
  cancelBackgroundPrediction();
  if (!state.latestPrediction && !hadBackgroundPrediction) return;
  state.latestPrediction = null;
  els.predictionStatus.textContent = "setup changed; load prediction again";
  if (els.predictionUnconstrained) els.predictionUnconstrained.textContent = "Setup changed. Load Prediction to rebuild the estimate.";
  if (els.flightHud) els.flightHud.textContent = "Setup changed. Load Prediction to simulate the matched record.";
  setWorkflowPredictionWorking(false);
  renderEvidenceWarnings(null);
  renderFlightView();
  updateEstimateBanner();
}

function isAbortError(error) {
  return error?.name === "AbortError" || /aborted/i.test(String(error?.message || error || ""));
}

function cancelBackgroundPrediction() {
  livePredictionController?.abort();
  livePredictionGeneration++;
  if (backgroundPredictionAbortController) {
    backgroundPredictionAbortController.abort();
    backgroundPredictionAbortController = null;
  }
  backgroundPredictionPromise = null;
}

function startBackgroundPrediction(reason = "marking complete") {
  if (state.latestPrediction || backgroundPredictionPromise || state.observations.length < 2 || state.skippedVideoMarks?.includes("contact") || !actualFieldMapGeometryReady()) {
    return backgroundPredictionPromise || Promise.resolve(state.latestPrediction);
  }
  const controller = new AbortController();
  backgroundPredictionAbortController = controller;
  els.predictionStatus.textContent = `building prediction in background (${reason})...`;
  let stopProgress = null;
  if (els.setupModal?.open && ["player", "description", "prediction", "export"].includes(activeWorkflowStep)) {
    stopProgress = startWorkflowPredictionProgress("Building prediction in background...");
  }
  let promise = null;
  promise = (async () => {
    try {
      await nextPaint();
      return await runLivePrediction({
        openModal: false,
        signal: controller.signal,
      });
    } catch (error) {
      if (!isAbortError(error)) {
        workflowError = error.message || String(error);
        els.predictionStatus.textContent = "background prediction failed";
        if (els.predictionUnconstrained) els.predictionUnconstrained.textContent = String(error.message || error);
      }
      return null;
    } finally {
      if (backgroundPredictionAbortController === controller) backgroundPredictionAbortController = null;
      if (backgroundPredictionPromise === promise) backgroundPredictionPromise = null;
      if (stopProgress) stopProgress({ complete: Boolean(state.latestPrediction) });
      else setWorkflowPredictionWorking(false);
      if (activeWorkflowStep === "player") renderWorkflowStep("player");
    }
  })();
  backgroundPredictionPromise = promise;
  return promise;
}

async function runLivePrediction({ openModal = true, signal = null } = {}) {
  if (window.GAMEFRAME_HOSTED && state.hostedUpload) await state.hostedUpload;
  if (state.observations.length < 2) {
    throw new Error("Add at least two ball points in the Ball Path step before building prediction.");
  }
  if (!actualFieldMapGeometryReady()) {
    throw new Error("Use the actual field map before building prediction. Mark camera position, home plate, second base or rubber, and landing spot.");
  }
  if (openModal) {
    els.predictionStatus.textContent = "estimating from current marks...";
    els.predictionUnconstrained.textContent = "Running estimator from the current observations and Hit Setup.";
    renderEvidenceWarnings(null);
    openPredictionModal();
  }
  livePredictionController?.abort();
  const controller = new AbortController(), generation = ++livePredictionGeneration;
  livePredictionController = controller;
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, {once:true});
  if (signal?.aborted) abort();
  try {
  const requestPackage=buildPackage();
  const prepared=earlyEstimatePreparation?.get(estimatePreparationKeys(requestPackage).request);
  const preparedResult=prepared?await prepared:null;
  if(controller.signal.aborted || generation!==livePredictionGeneration)throw new DOMException('Estimate superseded','AbortError');
  let directPrediction=preparedResult;
  if(directPrediction?.direction_first_match?.late_descent_rate?.used)directPrediction=null;
  if(!directPrediction){
  const liveResponse = await fetch("/api/predict", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify(requestPackage),
  });
  if (!liveResponse.ok) {
    const text = await liveResponse.text();
    let message = text;
    try {
      const parsed = JSON.parse(text);
      message = [parsed.error, parsed.stderr?.trim().split("\n").pop() || parsed.stdout?.trim()].filter(Boolean).join(": ") || text;
    } catch {
      // Keep raw text.
    }
    throw new Error(message || `prediction failed with HTTP ${liveResponse.status}`);
  }
  directPrediction = await liveResponse.json();
  }
  if (controller.signal.aborted || generation !== livePredictionGeneration) throw new DOMException('Estimate superseded', 'AbortError');
  state.latestPrediction = directPrediction;
  renderDirectPredictionCard(els.predictionUnconstrained, directPrediction);
  renderEvidenceWarnings(directPrediction);
  updateEstimateBanner();
  const best = practicalEstimate(directPrediction);
  els.showFlightView.disabled = !best;
  if (best) {
    state.flightView.visible = true;
    els.resetFlightView.hidden = false;
    setFlightPreset("video");
    renderFlightView();
  } else {
    renderFlightView();
  }
  els.predictionStatus.textContent = best
    ? `live estimate (${formatBestGuess(best)})`
    : "live estimate loaded";
  return directPrediction;
  } finally {
    signal?.removeEventListener('abort', abort);
    if (livePredictionController === controller) livePredictionController = null;
  }
}

async function loadPrediction() {
  try {
    await runLivePrediction({ openModal: true });
  } catch (error) {
    els.predictionStatus.textContent = "prediction failed";
    els.predictionUnconstrained.textContent = String(error.message || error);
    renderEvidenceWarnings(null);
    openPredictionModal();
  }
}

async function openSimulation() {
  if (!state.latestPrediction) {
    await loadPrediction();
    return;
  }
  openPredictionModal();
  showFlightView();
}

function bestPredictionRange(prediction = state.latestPrediction) {
  if (!prediction) return {};
  if (prediction.ev_candidates?.length) {
    const best = practicalEstimate(prediction);
    const candidateRange = displayedLikelyBands(best, summarizeBestCluster(prediction.ev_candidates, 5));
    return {
      ev: candidateRange?.ev_mph,
      la: candidateRange?.launch_angle_deg,
      distance: candidateRange?.distance_ft,
    };
  }
  const summary = prediction.unconstrained;
  const best = summary?.top?.[0];
  if (best) {
    const range = displayedLikelyBands(best, summarizeBestCluster(summary.top, 5));
    return {
      ev: range?.ev_mph,
      la: range?.launch_angle_deg,
      distance: range?.distance_ft,
    };
  }
  return {
    ev: summary?.range?.ev_mph,
    la: summary?.range?.launch_angle_deg,
    distance: summary?.range?.distance_ft,
  };
}

function clipBannerLines() {
  const best = bestPredictionRow();
  const diagnostic = isDiagnosticPrediction();
  const marker = diagnostic ? "~" : "";
  const ev = best ? `${marker}${formatNumber(best.exit_velocity_mph, 0, " mph")}` : "not loaded";
  const la = best ? `${marker}${formatNumber(best.launch_angle_deg, 0, " degrees")}` : "not loaded";
  const distance = best ? `${marker}${formatNumber(best.distance_ft, 0, " feet")}` : "not loaded";
  const hang = best ? formatNumber(best.hang_time_s, 1, " seconds") : "not loaded";
  const description = currentHitDescription();
  return [description, `EV ${ev}`, `LA ${la}`, `Distance ${distance}`, `Hang ${hang}`].filter(Boolean);
}

function safeFileStem(name) {
  return String(name || "hit-clip")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "hit-clip";
}

function waitForMediaMetadata(video) {
  if (video.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    video.addEventListener("loadedmetadata", resolve, { once: true });
    video.addEventListener("error", () => reject(new Error("Could not load video metadata.")), { once: true });
  });
}

function seekMedia(video, time) {
  return new Promise((resolve, reject) => {
    video.addEventListener("seeked", resolve, { once: true });
    video.addEventListener("error", () => reject(new Error("Could not seek video.")), { once: true });
    video.currentTime = time;
  });
}

function drawClipFrame(ctx2d, video, width, height, bannerHeight, lines) {
  ctx2d.fillStyle = "#061015";
  ctx2d.fillRect(0, 0, width, bannerHeight);
  ctx2d.fillStyle = "#f7fbfc";
  ctx2d.font = `700 ${Math.max(20, Math.round(bannerHeight * 0.3))}px Inter, Arial, sans-serif`;
  ctx2d.textBaseline = "middle";
  ctx2d.fillText(lines.join("   |   "), 24, Math.round(bannerHeight / 2));
  ctx2d.drawImage(video, 0, bannerHeight, width, height);
}

function nextRenderedVideoFrame(video) {
  if (typeof video.requestVideoFrameCallback === "function") {
    return new Promise((resolve) => {
      video.requestVideoFrameCallback((now, metadata) => resolve(metadata?.mediaTime ?? video.currentTime));
    });
  }
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve(video.currentTime));
  });
}

function nextPaint() {
  return new Promise((resolve) => {
    let first = null;
    let second = null;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      if (first !== null) cancelAnimationFrame(first);
      if (second !== null) cancelAnimationFrame(second);
      resolve();
    };
    // Background tabs may suspend animation frames while work should continue.
    const fallback = setTimeout(done, 150);
    first = requestAnimationFrame(() => { second = requestAnimationFrame(done); });
  });
}

function supportedMp4MimeType() {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4;codecs=h264",
    "video/mp4",
  ];
  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || null;
}

function setClipProgress(value, message, visible = true) {
  const progressValue = value == null ? null : Math.max(0, Math.min(1, value));
  if (els.clipProgressWrap) {
    els.clipProgressWrap.hidden = !visible;
    if (progressValue === null) els.clipProgress.removeAttribute("value");
    else els.clipProgress.value = progressValue;
    els.clipProgressText.textContent = message;
  }
  setWorkflowExportProgress(progressValue, message, visible);
}

function setWorkflowPredictionWorking(working, message = "Building prediction...") {
  const wrap = document.getElementById("workflow-prediction-working");
  const text = document.getElementById("workflow-prediction-working-text");
  const bar = document.getElementById("workflow-prediction-progress-bar");
  if (!wrap) return;
  wrap.hidden = !working;
  if (text) text.textContent = message;
  if (bar && working) bar.value = 0.05;
}

const PREDICTION_PROGRESS_STAGES = [
  { value: 0.04, ticks: 1, message: "Reading contact timing, ball marks, home/rubber landmarks, and map distance..." },
  { value: 0.10, ticks: 1, message: "Solving camera geometry and line-of-sight correction..." },
  { value: 0.18, ticks: 1, message: "Projecting the marked ball path into the camera model..." },
  { value: 0.28, ticks: 1, message: "Loading synthetic trajectory candidates..." },
  { value: 0.45, ticks: 2, message: "Rotating synthetic flights through the video camera..." },
  { value: 0.64, ticks: 4, message: "Comparing synthetic paths to the marked ball path..." },
  { value: 0.80, ticks: 4, message: "Scoring distance confidence, apex, and path fit..." },
  { value: 0.96, ticks: 12, message: "Ranking the best synthetic matches..." },
];

function startWorkflowPredictionProgress(startMessage = "Building prediction...") {
  const wrap = document.getElementById("workflow-prediction-working");
  const text = document.getElementById("workflow-prediction-working-text");
  const bar = document.getElementById("workflow-prediction-progress-bar");
  if (!wrap) return () => {};
  wrap.hidden = false;
  // Prediction has no server progress feed; do not invent percentages or stages.
  if (bar) bar.removeAttribute("value");
  if (text) text.textContent = startMessage;
  if (els.predictionStatus) els.predictionStatus.textContent = startMessage;
  return ({ complete = false } = {}) => {
    if (complete) {
      if (bar) bar.value = 1;
      if (text) text.textContent = "Prediction built.";
    } else {
      wrap.hidden = true;
    }
  };
}

function setWorkflowExportProgress(value, message, visible = true) {
  const wrap = document.getElementById("workflow-export-progress");
  const bar = document.getElementById("workflow-export-progress-bar");
  const text = document.getElementById("workflow-export-progress-text");
  if (!wrap) return;
  wrap.hidden = !visible;
  if (bar) {
    if (value == null) bar.removeAttribute("value");
    else bar.value = Math.max(0, Math.min(1, value));
  }
  if (text) text.textContent = message || "";
}

function setDataRecordsVisible(visible) {
  if (!els.dataRecords || !els.toggleDataRecords) return;
  els.dataRecords.hidden = !visible;
  els.toggleDataRecords.textContent = visible ? "Hide Records" : "Records";
  els.toggleDataRecords.setAttribute("aria-expanded", visible ? "true" : "false");
}

function toggleDataRecords() {
  setDataRecordsVisible(Boolean(els.dataRecords?.hidden));
}

function clipBuildPayload() {
  const packageData = buildPackage();
  // Identity is part of the export cache key because it appears in the video.
  return {
    file_name: state.fileName || state.videoMetadata?.file_name,
    contact_time_s: state.contactTime, pre_s: 1, post_s: 6,
    banner_text: clipBannerLines().join('|'),
    package: packageData, prediction: state.latestPrediction,
  };
}

async function prepareClippedVideo() {
  await pendingMapEvidence;
  if (!state.latestPrediction) await startBackgroundPrediction('prediction and video');
  if (!state.latestPrediction) throw new Error('Prediction is not ready. Retry saving.');
  if (needsLandingReview()) throw new Error('Review the landing direction before creating the video.');
  const blocker = predictionExportBlocker();
  if (blocker) throw new Error(blocker.message || 'Prediction needs review.');
  const payload = clipBuildPayload();
  const key = JSON.stringify(payload);
  if (!preparedClipBuild || preparedClipBuild.key !== key) {
    const build = {key, promise: null};
    preparedClipBuild = build;
    build.promise = buildClippedVideo(payload).then(result => {
      if (!result) throw new Error('Video preparation failed. Retry saving.');
      return result;
    }).catch(error => {
      if (preparedClipBuild === build) preparedClipBuild = null;
      throw error;
    });
  }
  const result = await preparedClipBuild.promise;
  if (!state.latestPrediction) throw new Error('Setup changed. Reopen Prediction and Video.');
  if (key !== JSON.stringify(clipBuildPayload())) return prepareClippedVideo();
  return result;
}

async function downloadClippedVideo() {
  try {
    const prepared = await prepareClippedVideo();
    setClipProgress(0.98, 'Saving EV video and data...');
    await saveHitTrack({clipJobId: prepared.job_id});
    window.location.href = prepared.download_url;
    setClipProgress(1, evSaveCompletionMessage());
    return true;
  } catch (error) {
    setClipProgress(0, `Save failed: ${error.message || error}`);
    return false;
  }
}

async function buildClippedVideo(payload) {
  if (state.contactTime === null) {
    els.autoTrackStatus.textContent = "Set contact before exporting a clip.";
    setClipProgress(0, "Set contact before exporting a clip.");
    return false;
  }
  const fileName = state.fileName || state.videoMetadata?.file_name;
  if (!fileName) {
    els.autoTrackStatus.textContent = "Load a video or observation JSON with a source filename before exporting a clip.";
    setClipProgress(0, "Load a video before exporting a clip.");
    return false;
  }

  try {
    if (els.downloadClip) els.downloadClip.disabled = true;
    if (!state.latestPrediction) {
      setClipProgress(0.01, "Estimating before export...");
      els.autoTrackStatus.textContent = "Building prediction before clip export...";
      await nextPaint();
      if (backgroundPredictionPromise) await backgroundPredictionPromise;
      else await runLivePrediction({ openModal: false });
    }
    const blocker = predictionExportBlocker();
    if (blocker) {
      const message = blocker.message || "The marked evidence does not reconcile cleanly enough to export.";
      renderEvidenceWarnings(state.latestPrediction);
      els.autoTrackStatus.textContent = `Export paused: ${message}`;
      setClipProgress(0, `Export paused: ${message}`);
      if (els.setupModal?.open && activeWorkflowStep === "player") renderWorkflowStep("player");
      return false;
    }
    setClipProgress(0.08, "Starting clip export...");
    await nextPaint();
    const response = await fetch("/api/clip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Clip API failed: HTTP ${response.status}`);
    const started = await response.json();
    if (!started.job_id) throw new Error("Clip API did not return a job id.");

    let status = null;
    for (let attempt = 0; attempt < 600; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const statusResponse = await fetch(`/api/clip/status?id=${encodeURIComponent(started.job_id)}`, { cache: "no-store" });
      if (!statusResponse.ok) throw new Error(`Clip status failed: HTTP ${statusResponse.status}`);
      status = await statusResponse.json();
      const progress = Number(status.progress || 0);
      setClipProgress(progress, status.message || `Encoding ${Math.round(progress * 100)}%`);
      if (status.status === "done") break;
      if (status.status === "error") throw new Error(status.error || "ffmpeg clip failed.");
    }
    if (!status || status.status !== "done" || !status.download_url) {
      throw new Error("Clip export timed out.");
    }
    setClipProgress(1, 'Video ready to save.');
    return {job_id: started.job_id, download_url: status.download_url};
  } catch (error) {
    els.autoTrackStatus.textContent = `Clip export failed: ${error.message || error}`;
    setClipProgress(0, `Clip export failed: ${error.message || error}`);
    return false;
  } finally {
    if (els.downloadClip) els.downloadClip.disabled = false;
  }
}

function setMarkerPosition(name, xPercent, yPercent) {
  const marker = name === "camera" ? els.cameraMarker : els.landingMarker;
  markers[name].x = Math.max(0, Math.min(100, xPercent));
  markers[name].y = Math.max(0, Math.min(100, yPercent));
  marker.style.left = `${markers[name].x}%`;
  marker.style.top = `${markers[name].y}%`;
}

function installMarkerDrag(marker, name) {
  marker.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    marker.setPointerCapture(event.pointerId);
  });
  marker.addEventListener("pointermove", (event) => {
    if (!marker.hasPointerCapture(event.pointerId)) return;
    const rect = els.fieldTool.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    setMarkerPosition(name, x, y);
    if (name === "landing") markPredictionStale();
  });
  marker.addEventListener("pointerup", (event) => {
    if (marker.hasPointerCapture(event.pointerId)) {
      marker.releasePointerCapture(event.pointerId);
    }
    markPredictionStale();
    persistDraft();
  });
}

function toggleFieldToolExpanded() {
  const expanded = !els.fieldTool.classList.contains("expanded");
  setFieldToolExpanded(expanded);
}

function setFieldToolExpanded(expanded) {
  els.fieldTool.classList.toggle("expanded", expanded);
  document.body.classList.toggle("field-tool-expanded", expanded);
  els.expandFieldTool.textContent = expanded ? "Close Field Diagram" : "Expand Field Diagram";
  els.closeFieldTool.hidden = !expanded;
  setMarkerPosition("camera", markers.camera.x, markers.camera.y);
  setMarkerPosition("landing", markers.landing.x, markers.landing.y);
}

let actualMapStage = "address";
const LANDING_CERTAINTY_OPTIONS = {
  clear: { feet: 5, confidence: 'HIGH' },
  area: { feet: 10, confidence: 'MEDIUM' },
  guess: { feet: 20, confidence: 'LOW' },
};
let landingReviewAcknowledged = null;
let landingReviewOriginal = null;
let landingReviewSaving = false;
let mapComparisonLayer = null;
let mapComparisonBounds = null;
let mapComparisonResize = null;
let mapComparisonHiddenLayers = [];

function selectedLandingLatLng(geometry, best) {
  const home = geometry?.home_lat_lng;
  const axis = geometry?.axis_lat_lng;
  if (!home || !axis || !best || ![home.lat, home.lng, axis.lat, axis.lng,
    best.landing_x_ft, best.landing_y_ft].every(Number.isFinite)) return null;
  // Field x is right of the home-to-axis bearing; y is toward center field.
  // Use the actual landing coordinates, not the initial spray angle.
  const distance = Math.hypot(best.landing_x_ft, best.landing_y_ft) / 3.280839895;
  const heading = geoRadians(geoHeadingDeg(home, axis)) + Math.atan2(best.landing_x_ft, best.landing_y_ft);
  const angular = distance / 6371008.8;
  const lat = geoRadians(home.lat), lng = geoRadians(home.lng);
  const outLat = Math.asin(Math.sin(lat) * Math.cos(angular) + Math.cos(lat) * Math.sin(angular) * Math.cos(heading));
  const outLng = lng + Math.atan2(Math.sin(heading) * Math.sin(angular) * Math.cos(lat),
    Math.cos(angular) - Math.sin(lat) * Math.sin(outLat));
  return { lat: geoDegrees(outLat), lng: ((geoDegrees(outLng) + 540) % 360) - 180 };
}

function fitMapComparison() {
  if (actualMapStage !== 'compare' || !mapComparisonBounds?.isValid()) return;
  const map = actualFieldMapState.map;
  map.invalidateSize({ animate: false });
  const narrow = els.actualFieldMap.clientWidth < 500;
  map.fitBounds(mapComparisonBounds, {
    paddingTopLeft: [narrow ? 32 : 65, 65],
    paddingBottomRight: [narrow ? 110 : 150, 65],
    maxZoom: 20, animate: false,
  });
}

function clearMapComparison() {
  mapComparisonResize?.disconnect();
  mapComparisonResize = null;
  mapComparisonLayer?.remove();
  mapComparisonLayer = null;
  mapComparisonBounds = null;
  for (const layer of mapComparisonHiddenLayers) layer.addTo(actualFieldMapState.map);
  mapComparisonHiddenLayers = [];
  document.getElementById('map-comparison-summary').hidden = true;
}

function openMapComparison() {
  if (!initializeActualFieldMap()) return;
  clearMapComparison();
  const geometry = actualFieldMapState.fieldGeometry;
  const review = state.latestPrediction?.distance_review;
  const comparisonRows = review?.alternatives?.length ? review.alternatives : review?.diagnostic_alternatives || [];
  const best = review?.required ? comparisonRows[0] : state.latestPrediction?.ev_candidates?.[0] || state.latestPrediction?.direction_first_match?.best;
  const matched = selectedLandingLatLng(geometry, best);
  const map = actualFieldMapState.map;
  for (const key of ['cameraMarker', 'homeMarker', 'axisMarker', 'landingMarker', 'cameraLine', 'axisLine', 'landingLine']) {
    const layer = actualFieldMapState[key];
    if (layer && map.hasLayer(layer)) { map.removeLayer(layer); mapComparisonHiddenLayers.push(layer); }
  }
  mapComparisonLayer = L.layerGroup().addTo(map);
  const points = [];
  const valid = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
  const marks = [
    ['Camera', geometry?.camera_lat_lng, '#1d8fff'],
    ['Home', geometry?.home_lat_lng, '#f7d154'],
    ['Field axis', geometry?.axis_lat_lng, '#ffffff'],
    ['Your landing mark', geometry?.landing_lat_lng, '#f47d85'],
    [review?.diagnostic_alternatives?.length ? 'Near your distance' : review?.required ? 'Match 1' : 'Selected match', matched, '#39e6b3'],
  ];
  for (const [label, point, color] of marks) {
    if (!valid(point)) continue;
    points.push(point);
    L.marker(point, {icon: actualMapMarkerIcon(label, color), draggable: false,
      keyboard: true, title: label, alt: label, zIndexOffset: label === 'Selected match' ? 100 : 0}).addTo(mapComparisonLayer);
  }
  const home = geometry?.home_lat_lng;
  for (const [point, color, dashArray] of [[geometry?.axis_lat_lng, '#ffffff', '5 6'],
    [geometry?.camera_lat_lng, '#1d8fff', '5 6'], [geometry?.landing_lat_lng, '#f47d85', null],
    [matched, '#39e6b3', '8 6']]) {
    if (valid(home) && valid(point)) L.polyline([home, point], {color, dashArray, weight: 3}).addTo(mapComparisonLayer);
  }
  const original = valid(home) && valid(geometry?.landing_lat_lng)
    ? actualMapFieldVectorFt(geometry.landing_lat_lng, home, geometry.axis_lat_lng) : null;
  const landingAngle = matched ? geoDegrees(Math.atan2(best.landing_x_ft, best.landing_y_ft)) : null;
  const summary = document.getElementById('map-comparison-summary');
  summary.innerHTML = `<div class="map-comparison-values">
    <p><strong class="map-user-color">Your landing mark</strong><span>${original ? `${Math.round(original.distance_ft)} ft  /  ${formatActualMapDirection(original.signed_angle_deg)}` : 'No saved field marks'}</span></p>
    <p><strong class="map-match-color">Selected match</strong><span>${matched ? `${formatNumber(best.exit_velocity_mph, 0, ' mph')}  /  ${Math.round(Math.hypot(best.landing_x_ft, best.landing_y_ft))} ft  /  ${formatActualMapDirection(landingAngle)}` : 'No matched landing position available'}</span></p>
    </div><p class="map-comparison-note">Your original marks are unchanged. The dashed green line shows the estimated landing position of the selected trajectory.</p>`;
  summary.hidden = false;
  if (review?.required) {
    const alternatives = comparisonRows;
    for (const [i, row] of alternatives.entries()) {
      if (i === 0) continue;
      const point = selectedLandingLatLng(geometry, row);
      if (!valid(point)) continue;
      points.push(point);
      L.marker(point, {icon: actualMapMarkerIcon(row.comparison_label ? 'Failed video fit' : `Match ${i + 1}`, reviewColors[i]), draggable: false}).addTo(mapComparisonLayer);
      if (valid(home)) L.polyline([home, point], {color: reviewColors[i], dashArray: '8 6', weight: 3}).addTo(mapComparisonLayer);
    }
    summary.innerHTML = `<p><strong>${escapeHtml(review.title)}</strong></p><p>Your mark: ${formatNumber(review.claimed_distance_ft, 0, ' ft')}</p>` +
      alternatives.map((row, i) => `<p style="color:${reviewColors[i]}">${escapeHtml(row.comparison_label || `Match ${i + 1}`)}: ${formatNumber(row.distance_ft, 0, ' ft')}  /  ${formatNumber(row.exit_velocity_mph, 0, ' mph')}</p>`).join('') +
      '<p>Your marks are unchanged. Close this comparison and edit the marks, then recalculate.</p>';
    if (review.camera_comparison) {
      const camera = review.camera_comparison;
      const suggested = selectedLandingLatLng(geometry, {landing_x_ft: camera.suggested_center_ft[0], landing_y_ft: camera.suggested_center_ft[1]});
      if (valid(suggested)) {
        points.push(suggested);
        L.marker(suggested, {icon: actualMapMarkerIcon('Camera from field lines', '#39e6b3'), draggable: false}).addTo(mapComparisonLayer);
        if (valid(home)) L.polyline([home, suggested], {color: '#39e6b3', dashArray: '8 6', weight: 3}).addTo(mapComparisonLayer);
      }
      summary.innerHTML = `<p><strong>Camera comparison  -  distance has not been tested</strong></p>${cameraComparisonMarkup(camera)}<p>Your marks are unchanged. Review this suggestion against where you filmed.</p>`;
    } else if (review.diagnostic_alternatives?.length) {
      summary.innerHTML += '<p>These are the closest failed fits, not supported landing estimates.</p>';
    }
  }
  document.getElementById('map-distance-review').hidden = true;
  syncMapVideo();
  document.getElementById('actual-map-video-panel').open = false;
  if (!els.actualFieldMapModal.open) els.actualFieldMapModal.showModal();
  setActualMapStage('compare');
  actualMapSetStatus(points.length ? '' : 'This hit has no saved map coordinates. Open Edit Video Setup to add field marks.', !points.length);
  mapComparisonBounds = points.length ? L.latLngBounds(points) : null;
  mapComparisonResize = new ResizeObserver(() => requestAnimationFrame(fitMapComparison));
  mapComparisonResize.observe(els.actualFieldMap);
  requestAnimationFrame(fitMapComparison);
}

function landingDistanceMismatch(prediction) {
  const best = prediction?.direction_first_match?.best || prediction?.path_only_model_fit?.best;
  const modeled = Number(best?.distance_ft);
  const marked = Number(prediction?.field_direction?.estimated_distance_ft);
  if (!(modeled > 0) || !(marked > 0)) return null;
  const gap = Math.abs(modeled - marked);
  return gap > Math.max(40, modeled * 0.16) ? { modeled, marked, gap } : null;
}

function needsLandingReview() {
  if (state.latestPrediction?.distance_review) return state.latestPrediction.distance_review.required;
  return state.latestPrediction !== landingReviewAcknowledged && Boolean(landingDistanceMismatch(state.latestPrediction));
}

const reviewColors = ['#08795b', '#1764ae', '#8842aa'];

function cameraComparisonMarkup(camera) {
  if (!camera) return '';
  return `<p>Your camera mark: <strong>${formatNumber(camera.mapped_distance_ft, 0, ' ft from home')}</strong>.<br>Field-line estimate: <strong>${formatNumber(camera.suggested_distance_ft, 0, ' ft from home')}</strong>.<br>The positions differ by ${formatNumber(camera.position_difference_ft, 0, ' ft')}.</p><p>The estimate assumes a camera height of ${formatNumber(camera.camera_height_ft, 1, ' ft')} and accurate field marks. Compare it with where you filmed before changing anything.</p>`;
}

function distanceHangEvidenceMarkup(prediction = state.latestPrediction) {
  const match = prediction?.distance_hang_match;
  if (!match) return '';
  const ranges = match.ranges || {};
  const rangeText = (key,unit) => ranges[key] ? `${formatNumber(ranges[key][0],1)}-${formatNumber(ranges[key][1],1)} ${unit}` : 'No supported range';
  const video = match.video_alignment || {};
  return `<section class="landing-review-notice" role="status">
    <h3>Calculated flights for your distance and time in air</h3>
    <p>You entered a landing distance of <strong>${formatNumber(match.target_distance_ft,0,' ft')} +/- ${formatNumber(match.distance_tolerance_ft,0,' ft')}</strong> and a time in air of <strong>${formatNumber(match.target_hang_time_s,3,' s')} +/- ${formatNumber(match.hang_time_tolerance_s,3,' s')}</strong>. Candidates must meet both, plus the marked landing direction.</p>
    <p>Searched candidate range: <strong>${rangeText('exit_velocity_mph','mph')}</strong>; launch <strong>${rangeText('launch_angle_deg',' deg')}</strong>. This is not a confidence interval. It assumes estimated spin, default weather and contact ${formatNumber(match.contact_origin_ft?.[2],1,' ft')} above home plate.</p>
    <ul>${(match.candidates || []).slice(0,5).map(row=>`<li>${formatNumber(row.exit_velocity_mph,1,' mph')}  /  ${formatNumber(row.launch_angle_deg,1,' deg')}  /  ${formatNumber(row.distance_ft,0,' ft')}  /  ${formatNumber(row.hang_time_s,2,' s')}</li>`).join('')}</ul>
    <h4>Separate video alignment check</h4>
    <p>${video.calibration_usable ? 'Camera-dependent projection' : 'Camera calibration is uncertain'}${Number.isFinite(video.best_rmse_px) ? `; the first candidate has ${formatNumber(video.best_rmse_px,1,' px')} position error` : ''}. Pixel alignment does not rank or reject these distance/hang-time matches. These are conditional estimates, not independently validated measurements.</p>
  </section>`;
}

function distanceReviewMarkup(prediction = state.latestPrediction) {
  const review = prediction?.distance_review;
  if (!review?.required) return '';
  const diagnostic = !review.alternatives?.length && Boolean(review.diagnostic_alternatives?.length);
  const alternatives = diagnostic ? review.diagnostic_alternatives : review.alternatives || [];
  const claim = Number(review.claimed_distance_ft);
  return `<section class="landing-review-notice" role="status">
    <h3>${escapeHtml(review.title)}</h3><p>${escapeHtml(review.message)}</p>
    ${cameraComparisonMarkup(review.camera_comparison)}
    ${diagnostic ? '<p><strong>None of these calculated flights follows the selected ball positions and entered distance closely enough.</strong></p>' : ''}
    ${claim > 0 ? `<p>Your distance: <strong>${Math.round(claim)} ft</strong></p>` : ''}
    ${alternatives.length ? `<ul>${alternatives.map((row, i) => `<li style="color:${reviewColors[i]}">${escapeHtml(row.comparison_label || `Match ${i + 1}`)}: <strong>${formatNumber(row.distance_ft, 0, ' ft')}</strong>  /  ${formatNumber(row.exit_velocity_mph, 0, ' mph')}  /  ${formatNumber(row.launch_angle_deg, 0, ' deg')}${diagnostic ? `  /  ${formatNumber(row.projected_path_rmse_px, 1, ' px error')}` : ''}${claim > 0 ? `  /  ${Math.round(Math.abs(row.distance_ft - claim))} ft ${row.distance_ft < claim ? 'shorter' : 'longer'}` : ''}</li>`).join('')}</ul>
      <p>White points are your ball marks. Colored paths are model comparisons. ${review.late_observation_policy==='timing_only'?'Only the early spatial path is compared in pixels; later marks constrain rise/descent timing. ':''}These are comparisons, not accepted estimates for your marked distance.</p>
      <div id="distance-review-video-wrap">
        <video id="distance-review-video" muted playsinline controls></video>
        <svg id="distance-review-overlay" aria-label="Observed ball positions and alternative trajectories" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"></svg>
      </div>` : ''}
    <div class="button-row">${review.status === 'camera_setup_conflict' ? '<button id="review-camera-map" type="button">Review camera position</button><button id="review-camera-comparison" type="button">Compare camera positions</button>' : '<button id="review-landing-point" type="button">Edit landing mark</button><button id="review-video-marks" type="button">Review contact and ball marks</button>'}<button id="review-field-marks" type="button">Review video field marks</button><button id="review-recalculate" type="button">Recalculate</button></div>
  </section>`;
}

function setupDistanceReview() {
  const review = state.latestPrediction?.distance_review;
  if (!review?.required) return;
  setupWorkflowButton('review-field-marks', () => goToWorkflowStep('landmarks'));
  setupWorkflowButton('review-camera-comparison', openMapComparison);
  setupWorkflowButton('review-camera-map', () => { openLandingReview(); actualMapSetMode('camera'); });
  setupWorkflowButton('review-video-marks', () => goToWorkflowStep('ballPath'));
  setupWorkflowButton('review-recalculate', async () => {
    const button = document.getElementById('review-recalculate');
    button.disabled = true;
    button.textContent = 'Recalculating...';
    workflowError = '';
    const stopProgress = startWorkflowPredictionProgress('Recalculating from your current marks...');
    try { await runLivePrediction({openModal: false}); }
    catch (error) { workflowError = error.message || String(error); }
    finally { stopProgress({complete: !workflowError}); renderWorkflowStep('player'); }
  });
  const video = document.getElementById('distance-review-video');
  const svg = document.getElementById('distance-review-overlay');
  if (!video || !svg) return;
  const width = state.latestPrediction?.video_metadata?.width_px || els.video.videoWidth || 1280;
  const height = state.latestPrediction?.video_metadata?.height_px || els.video.videoHeight || 720;
  document.getElementById('distance-review-video-wrap').style.setProperty('--review-video-ratio', String(width / height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const clean = points => (points || []).filter(p => p.length === 2 && p.every(Number.isFinite));
  const withContact = points => clean([...(review.contact_pixel ? [review.contact_pixel] : []), ...(points || [])]);
  const rows = review.alternatives?.length ? review.alternatives : review.diagnostic_alternatives || [];
  svg.innerHTML = rows.map((row, i) => `<polyline points="${withContact(row.projected_curve_pixels || row.projected_pixels).map(p => p.join(',')).join(' ')}" fill="none" stroke="${reviewColors[i]}" stroke-width="3"/>`).join('') +
    withContact(review.observed_pixels).map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="5" fill="white" stroke="black" stroke-width="2"/>`).join('');
  video.src = els.video.currentSrc || els.video.src;
  video.onloadedmetadata = () => { video.currentTime = Math.max(0, state.contactTime || 0); };
}

function landingReviewText() {
  const mismatch = landingDistanceMismatch(state.latestPrediction);
  return mismatch ? `Model: ${Math.round(mismatch.modeled)} ft. Your mark: ${Math.round(mismatch.marked)} ft. Review the landing direction against the video. A small direction error could explain the gap.` : '';
}

function syncMapVideo() {
  const video = document.getElementById('actual-map-video');
  const source = els.video.currentSrc || els.video.src;
  if (source && video.getAttribute('src') !== source) {
    video.src = source;
    video.onloadedmetadata = () => { video.currentTime = Math.max(0, (state.contactTime || 0) - 0.5); };
  }
}

function openLandingReview() {
  if (!actualMapReadyForConfirm() || !initializeActualFieldMap()) return;
  landingReviewOriginal = Object.fromEntries(['camera', 'home', 'axis', 'landing'].map(key => [key, { ...actualFieldMapState[key] }]));
  actualMapSetMode('landing');
  for (const name of ['cameraMarker', 'homeMarker', 'axisMarker']) actualFieldMapState[name]?.dragging?.enable();
  syncMapVideo();
  document.getElementById('actual-map-video-panel').open = true;
  document.getElementById('map-distance-review').textContent = 'Drag any mark, or choose a point below and click its corrected location. Recalculate when finished.';
  document.getElementById('map-distance-review').hidden = false;
  if (!els.actualFieldMapModal.open) els.actualFieldMapModal.showModal();
  setActualMapStage('review');
}

function cancelLandingReview() {
  if (landingReviewSaving) return;
  if (landingReviewOriginal) {
    for (const key of ['camera', 'home', 'axis', 'landing']) {
      actualFieldMapState[key] = landingReviewOriginal[key];
      actualFieldMapState[`${key}Marker`].setLatLng(landingReviewOriginal[key]);
    }
    actualMapUpdateMeasurements();
  }
  closeActualFieldMapModal();
}

function setActualMapStage(stage) {
  if (!LANDING_CERTAINTY_OPTIONS[state.distanceCertainty]) state.distanceCertainty = 'guess';
  actualMapStage = stage;
  els.actualFieldMapModal.dataset.stage = stage;
  renderMapMarkingPrompt();
  document.getElementById('landing-certainty').hidden = !['confirm', 'review'].includes(stage);
  document.querySelectorAll('input[name="landing-certainty"]').forEach(input => {
    input.checked = input.value === state.distanceCertainty;
  });
  document.getElementById("actual-field-map-title").textContent = stage === "address"
    ? "Select The Field Address"
    : stage === "confirm" ? `Confirm landing: ${Math.round(actualFieldMapState.distanceFt)} ft` : actualMapGuideText();
  if(stage==='confirm'){actualFieldMapState.mode='landing';actualMapSetStatus('Drag the landing marker or click the map to adjust. Choose your confidence, then confirm.');}
  els.actualMapContinue.hidden = stage === "points";
  els.actualMapContinue.disabled = stage === "address" ? !els.actualFieldSearch.value.trim() : (!actualMapReadyForConfirm() || !state.distanceCertainty);
  els.actualMapContinue.textContent = stage === "address" ? "Continue" : stage==='confirm' ? 'Confirm landing' : "Confirm";
  els.actualMapReset.hidden = true;
  els.actualMapReset.textContent = 'Start over';
  els.actualMapBackDiagram.hidden = ['points','confirm'].includes(stage);
  els.actualMapBackDiagram.textContent = stage === "address" ? "Close" : "Back";
  document.getElementById('actual-map-keep-original').hidden = stage !== 'review';
  if (state.latestPrediction?.distance_review?.required) document.getElementById('actual-map-keep-original').hidden = true;
  if (stage === 'review') {
    document.getElementById('actual-field-map-title').textContent = 'Edit Map Marks';
    els.actualMapContinue.textContent = 'Use Marks And Recalculate';
    els.actualMapBackDiagram.textContent = 'Cancel';
  }
  if (stage === 'compare') {
    document.getElementById('actual-field-map-title').textContent = 'Your Marks and Selected Match';
    els.actualMapBackDiagram.textContent = 'Close';
    els.actualMapContinue.hidden = true;
  }
  refreshActualFieldMap();
}

function actualMapSetStatus(message, isError = false) {
  if (!els.actualFieldMapStatus) return;
  els.actualFieldMapStatus.textContent = message;
  els.actualFieldMapStatus.classList.toggle("error", isError);
}

function actualMapReadyForConfirm() {
  const state = actualFieldMapState;
  return Boolean(
    state.camera &&
    state.home &&
    state.axis &&
    state.landing &&
    Number.isFinite(state.distanceFt) &&
    Number.isFinite(state.signedDirectionDeg)
  );
}

function actualMapUpdateConfirmState({ preserveStatus = false } = {}) {
  const ready = actualMapReadyForConfirm();
  if (actualMapStage === 'review') {
    els.actualMapContinue.disabled = !ready || !state.distanceCertainty;
    return;
  }
  if (actualMapStage === "address") return;
  if (ready) setActualMapStage("confirm");
  if (els.actualMapContinue) {
    els.actualMapContinue.disabled = !ready || !state.distanceCertainty;
    els.actualMapContinue.textContent = ready ? 'Confirm landing' : "Confirm";
  }
  if (ready && !preserveStatus) {
    actualMapSetStatus(
      `${Math.round(actualFieldMapState.distanceFt)} ft, ${formatActualMapDirection(actualFieldMapState.signedDirectionDeg)}`
    );
  }
}

function actualMapGuideText(mode = actualFieldMapState.mode) {
  if (mode === "home") return "Click home plate on the map";
  if (mode === "axis") return "Click second base on the map";
  if (mode === "landing") return "Click where the ball first touched the ground";
  return "Click where you stood while filming";
}

function actualMapSetMode(mode) {
  actualFieldMapState.mode = mode;
  els.actualMapCameraStep?.classList.toggle("active", mode === "camera");
  els.actualMapHomeStep?.classList.toggle("active", mode === "home");
  els.actualMapAxisStep?.classList.toggle("active", mode === "axis");
  els.actualMapLandingStep?.classList.toggle("active", mode === "landing");
  actualMapSetStatus(actualMapGuideText(mode));
  if (actualMapStage === "points") document.getElementById("actual-field-map-title").textContent = actualMapGuideText(mode);
  actualMapUpdateConfirmState({ preserveStatus: true });
  renderMapMarkingPrompt();
}

function renderMapMarkingPrompt() {
  const map = document.getElementById("actual-field-map");
  if (!map) return;
  let prompt = map.querySelector(".map-marking-prompt");
  if (!prompt) {
    prompt = document.createElement("div");
    prompt.className = "map-marking-prompt marking-prompt";
    prompt.setAttribute("role", "status");
    prompt.setAttribute("aria-live", "polite");
    map.appendChild(prompt);
  }
  if (actualMapStage !== "points") dismissMarkingPrompt(prompt, true);
  else flashMarkingPrompt(prompt, actualMapGuideText());
}

function actualMapMarkerIcon(label, color) {
  return L.divIcon({
    className: "actual-map-marker",
    html: `
      <span class="actual-map-marker-dot" style="--marker-color:${color};"></span>
      <span class="actual-map-marker-label">${label}</span>
    `,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

function geoRadians(degrees) {
  return degrees * Math.PI / 180;
}

function geoDegrees(radians) {
  return radians * 180 / Math.PI;
}

function geoDistanceMeters(a, b) {
  const radius = 6371008.8;
  const lat1 = geoRadians(a.lat);
  const lat2 = geoRadians(b.lat);
  const dLat = geoRadians(b.lat - a.lat);
  const dLng = geoRadians(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * radius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function geoHeadingDeg(a, b) {
  const lat1 = geoRadians(a.lat);
  const lat2 = geoRadians(b.lat);
  const dLng = geoRadians(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (geoDegrees(Math.atan2(y, x)) + 360) % 360;
}

function signedHeadingDeltaDeg(fromHeading, toHeading) {
  return ((toHeading - fromHeading + 540) % 360) - 180;
}

function actualMapFieldVectorFt(point, homePoint, axisPoint) {
  if (!point || !homePoint || !axisPoint) return null;
  const distanceFt = geoDistanceMeters(homePoint, point) * 3.280839895;
  const fieldHeading = geoHeadingDeg(homePoint, axisPoint);
  const pointHeading = geoHeadingDeg(homePoint, point);
  const signedDeg = signedHeadingDeltaDeg(fieldHeading, pointHeading);
  const rad = (signedDeg * Math.PI) / 180;
  return {
    x_ft: Math.sin(rad) * distanceFt,
    y_ft: Math.cos(rad) * distanceFt,
    distance_ft: distanceFt,
    signed_angle_deg: signedDeg,
  };
}

function formatActualMapDirection(angle) {
  if (!Number.isFinite(angle)) return "--";
  const abs = Math.abs(angle);
  if (abs < 3) return "Straightaway";
  return `${Math.round(abs)} deg ${angle < 0 ? "left" : "right"}`;
}

function directionValueFromSignedAngle(angle) {
  if (!Number.isFinite(angle)) return "unknown";
  if (angle <= -38) return "left_field";
  if (angle < -12) return "left_center";
  if (angle <= 12) return "center_field";
  if (angle < 38) return "right_center";
  return "right_field";
}

function setLandingMarkerFromDistanceDirection(distanceFt, signedDirectionDeg) {
  const profile = currentFieldProfile();
  const scale = 234 / Math.max(1, profile.fenceFt);
  const rad = (signedDirectionDeg * Math.PI) / 180;
  const svgX = 180 + Math.sin(rad) * distanceFt * scale;
  const svgY = 316 - Math.cos(rad) * distanceFt * scale;
  setMarkerPosition("landing", svgX / 3.6, svgY / 4.2);
}

function setCameraMarkerFromMapPoints(cameraPoint, homePoint, axisPoint) {
  if (!cameraPoint || !homePoint || !axisPoint) return;
  const baseDistanceFt = Math.max(1, currentFieldProfile().baseFt);
  const scale = 234 / Math.max(1, currentFieldProfile().fenceFt);
  const cameraDistanceFt = geoDistanceMeters(homePoint, cameraPoint) * 3.280839895;
  const fieldHeading = geoHeadingDeg(homePoint, axisPoint);
  const cameraHeading = geoHeadingDeg(homePoint, cameraPoint);
  const signedCameraDeg = signedHeadingDeltaDeg(fieldHeading, cameraHeading);
  const clampedDistanceFt = Math.min(Math.max(cameraDistanceFt, 10), currentFieldProfile().fenceFt);
  const rad = (signedCameraDeg * Math.PI) / 180;
  const svgX = 180 + Math.sin(rad) * clampedDistanceFt * scale;
  const svgY = 316 - Math.cos(rad) * clampedDistanceFt * scale;
  setMarkerPosition("camera", svgX / 3.6, svgY / 4.2);

  const sideThresholdFt = Math.max(18, baseDistanceFt * 0.35);
  if (els.cameraVantage) {
    if (cameraDistanceFt < baseDistanceFt * 0.9 && Math.abs(signedCameraDeg) > 155) {
      els.cameraVantage.value = "behind_home";
    } else if (signedCameraDeg < -sideThresholdFt / Math.max(cameraDistanceFt, 1) * 57.3) {
      els.cameraVantage.value = "third_base_backstop_fan_side";
    } else if (signedCameraDeg > sideThresholdFt / Math.max(cameraDistanceFt, 1) * 57.3) {
      els.cameraVantage.value = "first_base_backstop_fan_side";
    }
  }
}

function actualMapRedrawLines() {
  const state = actualFieldMapState;
  for (const key of ["cameraLine", "axisLine", "landingLine"]) {
    if (state[key]) {
      state[key].remove();
      state[key] = null;
    }
  }
  if (state.camera && state.home) {
    state.cameraLine = L.polyline([state.camera, state.home], {
      color: "#1d8fff",
      dashArray: "6 6",
      weight: 3,
      opacity: 0.95,
    }).addTo(state.map);
  }
  if (state.home && state.axis) {
    state.axisLine = L.polyline([state.home, state.axis], {
      color: "#ffffff",
      dashArray: "8 7",
      weight: 3,
      opacity: 0.95,
    }).addTo(state.map);
  }
  if (state.home && state.landing) {
    state.landingLine = L.polyline([state.home, state.landing], {
      color: "#f7d154",
      weight: 4,
      opacity: 0.95,
    }).addTo(state.map);
  }
}

function actualMapUpdateMeasurements() {
  const state = actualFieldMapState;
  actualMapRedrawLines();
  state.distanceFt = null;
  state.signedDirectionDeg = null;
  state.fieldGeometry = null;
  if (!state.home || !state.landing) {
    if (els.actualMapDistance) els.actualMapDistance.textContent = "-- ft";
    if (els.actualMapDirection) els.actualMapDirection.textContent = "--";
    return;
  }
  state.distanceFt = geoDistanceMeters(state.home, state.landing) * 3.280839895;
  if (state.axis) {
    const fieldHeading = geoHeadingDeg(state.home, state.axis);
    const landingHeading = geoHeadingDeg(state.home, state.landing);
    state.signedDirectionDeg = signedHeadingDeltaDeg(fieldHeading, landingHeading);
    const cameraVector = actualMapFieldVectorFt(state.camera, state.home, state.axis);
    const landingVector = actualMapFieldVectorFt(state.landing, state.home, state.axis);
    if (cameraVector && landingVector) {
      state.fieldGeometry = {
        source: "actual_field_map",
        home_lat_lng: { lat: state.home.lat, lng: state.home.lng },
        axis_lat_lng: { lat: state.axis.lat, lng: state.axis.lng },
        camera_lat_lng: state.camera ? { lat: state.camera.lat, lng: state.camera.lng } : null,
        landing_lat_lng: { lat: state.landing.lat, lng: state.landing.lng },
        field_heading_deg: fieldHeading,
        camera_xy_ft: { x: cameraVector.x_ft, y: cameraVector.y_ft },
        landing_xy_ft: { x: landingVector.x_ft, y: landingVector.y_ft },
        camera_distance_ft: cameraVector.distance_ft,
        landing_distance_ft: landingVector.distance_ft,
        camera_angle_deg: cameraVector.signed_angle_deg,
        landing_angle_deg: landingVector.signed_angle_deg,
        evidence_image_data_url: state.evidenceImageDataUrl || null,
      };
    }
  }
  if (els.actualMapDistance) els.actualMapDistance.textContent = `${Math.round(state.distanceFt)} ft`;
  if (els.actualMapDirection) els.actualMapDirection.textContent = formatActualMapDirection(state.signedDirectionDeg);
  actualMapUpdateConfirmState();
}

function actualMapPlacePoint(latlng) {
  const state = actualFieldMapState;
  if (!state.map || !['points', 'confirm', 'review'].includes(actualMapStage)) return;
  if (state.mode === "camera") {
    state.camera = latlng;
    if (state.cameraMarker) state.cameraMarker.remove();
    state.cameraMarker = L.marker(latlng, { icon: actualMapMarkerIcon("Camera", "#1d8fff"), draggable: true }).addTo(state.map);
    state.cameraMarker.on("drag", (event) => {
      state.camera = event.target.getLatLng();
      actualMapUpdateMeasurements();
    });
    actualMapSetMode("home");
  } else if (state.mode === "home") {
    state.home = latlng;
    if (state.homeMarker) state.homeMarker.remove();
    state.homeMarker = L.marker(latlng, { icon: actualMapMarkerIcon("Home", "#f7d154"), draggable: true }).addTo(state.map);
    state.homeMarker.on("drag", (event) => {
      state.home = event.target.getLatLng();
      actualMapUpdateMeasurements();
    });
    actualMapSetMode("axis");
  } else if (state.mode === "axis") {
    state.axis = latlng;
    if (state.axisMarker) state.axisMarker.remove();
    state.axisMarker = L.marker(latlng, { icon: actualMapMarkerIcon("Second", "#1d8fff"), draggable: true }).addTo(state.map);
    state.axisMarker.on("drag", (event) => {
      state.axis = event.target.getLatLng();
      actualMapUpdateMeasurements();
    });
    actualMapSetMode("landing");
  } else {
    state.landing = latlng;
    if (state.landingMarker) state.landingMarker.remove();
    state.landingMarker = L.marker(latlng, { icon: actualMapMarkerIcon("Landing", "#e24d4d"), draggable: true }).addTo(state.map);
    state.landingMarker.on("drag", (event) => {
      state.landing = event.target.getLatLng();
      actualMapUpdateMeasurements();
    });
  }
  actualMapUpdateMeasurements();
}

function actualMapResetPoints() {
  const state = actualFieldMapState;
  for (const key of ["cameraMarker", "homeMarker", "axisMarker", "landingMarker", "cameraLine", "axisLine", "landingLine"]) {
    if (state[key]) {
      state[key].remove();
      state[key] = null;
    }
  }
  state.camera = null;
  state.home = null;
  state.axis = null;
  state.landing = null;
  state.distanceFt = null;
  state.signedDirectionDeg = null;
  state.fieldGeometry = null;
  state.evidenceImageDataUrl = null;
  state.autoContinuing = false;
  actualMapSetMode("camera");
  actualMapUpdateMeasurements();
  actualMapSetStatus(actualMapGuideText("camera"));
  actualMapUpdateConfirmState({ preserveStatus: true });
}

function initializeActualFieldMap() {
  if (actualFieldMapState.map || !els.actualFieldMap) return true;
  if (!window.L) {
    actualMapSetStatus("Map library did not load. Check internet access before continuing.", true);
    return false;
  }
  const savedLocation = readSavedActualFieldLocations()[0];
  const initialCenter = actualFieldMapState.camera || (savedLocation ? [Number(savedLocation.lat), Number(savedLocation.lon)] : [42.8864, -78.8784]);
  const map = L.map(els.actualFieldMap, {
    zoomControl: true,
    attributionControl: true,
  }).setView(initialCenter, savedLocation ? 18 : 17);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 20,
    attribution: "Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  }).addTo(map);
  L.control.scale({ imperial: true, metric: false, maxWidth: 180 }).addTo(map);
  map.on("click", (event) => actualMapPlacePoint(event.latlng));
  actualFieldMapState.map = map;
  return true;
}

function refreshActualFieldMap() {
  if (!actualFieldMapState.map) return;
  requestAnimationFrame(() => actualFieldMapState.map.invalidateSize({ animate: false }));
  setTimeout(() => actualFieldMapState.map.invalidateSize({ animate: false }), 250);
}

let peopleConfirmedVideo = null;
function openEvPeopleSelection() {
  const dialog = document.getElementById('ev-people-modal');
  document.getElementById('ev-people-status').textContent = '';
  if (!dialog.open) dialog.showModal();
}
document.getElementById('ev-people-close').addEventListener('click', () => document.getElementById('ev-people-modal').close());
async function continueEvPeopleSelection() {
  if (!selectedGameFrameTeamId() || !selectedGameFrameHitterId()) {
    document.getElementById('ev-people-status').textContent = 'Choose a team and player to continue.';
    return;
  }
  rememberGameFramePeople();
  peopleConfirmedVideo = els.video.src;
  try {
    await openActualFieldMapModal();
  } catch (error) {
    document.getElementById('ev-people-status').textContent = error.message || 'Could not open the field map. Please try again.';
  }
}
document.getElementById('ev-people-form').addEventListener('submit', event => {
  event.preventDefault();
  void continueEvPeopleSelection();
});

async function openActualFieldMapModal() {
  if (!selectedGameFrameTeamId() || !selectedGameFrameHitterId() || peopleConfirmedVideo !== els.video.src) {
    openEvPeopleSelection();
    return;
  }

  if (!els.actualFieldMapModal?.showModal) return;
  if (!initializeActualFieldMap()) {
    document.getElementById('ev-people-status').textContent = 'The field map could not load. Please reload and try again.';
    return;
  }
  renderSavedActualFieldLocations();
  syncMapVideo();
  document.getElementById('map-distance-review').hidden = true;
  document.getElementById('ev-people-modal').close();
  if (!els.actualFieldMapModal.open) els.actualFieldMapModal.showModal();
  setActualMapStage(actualMapReadyForConfirm() ? "points" : "address");
  workflowMapSnapshot = workflowMapSignature();
  renderWorkflowNavigation("geometry");
  refreshActualFieldMap();
  actualMapUpdateConfirmState();
  if (!actualMapReadyForConfirm()) actualMapSetStatus(actualMapGuideText(actualFieldMapState.mode));
  try {
    const response = await fetch('/api/gameframe/field-locations', { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' });
    if (!response.ok) throw new Error('Could not load saved addresses');
    savedFieldLocations = (await response.json()).locations;
    renderSavedActualFieldLocations();
    if (savedFieldLocations.length && !actualFieldMapState.camera && !els.actualFieldSearch.value.trim()) {
      els.actualFieldSavedLocation.value = '0';
      useSavedActualFieldLocation();
    }
  } catch (error) { actualMapSetStatus(error.message, true); }
}

function closeActualFieldMapModal() {
  clearMapComparison();
  document.getElementById('actual-map-video').pause();
  document.getElementById('map-distance-review').hidden = true;
  landingReviewOriginal = null;
  for (const name of ['cameraMarker', 'homeMarker', 'axisMarker']) actualFieldMapState[name]?.dragging?.enable();
  if (els.actualFieldMapModal?.open) els.actualFieldMapModal.close();
}

let savedFieldLocations = null;
function readSavedActualFieldLocations() {
  if (savedFieldLocations) return savedFieldLocations;
  try {
    const rows = JSON.parse(localStorage.getItem(ACTUAL_FIELD_SAVED_LOCATIONS_KEY) || "[]");
    return Array.isArray(rows)
      ? rows.filter((row) => row && Number.isFinite(Number(row.lat)) && Number.isFinite(Number(row.lon)))
      : [];
  } catch {
    return [];
  }
}

async function writeSavedActualFieldLocations(rows) {
  const response = await fetch('/api/gameframe/field-locations', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({location:rows[0]}) });
  if (!response.ok) throw new Error('Address could not be saved. Please try again.');
  savedFieldLocations = (await response.json()).locations;
  try {
    localStorage.setItem(ACTUAL_FIELD_SAVED_LOCATIONS_KEY, JSON.stringify(savedFieldLocations));
  } catch (error) {
    console.warn("Could not save field location list", error);
  }
}

function renderSavedActualFieldLocations() {
  if (!els.actualFieldSavedLocation) return;
  const previous = els.actualFieldSavedLocation.value;
  const rows = readSavedActualFieldLocations();
  els.actualFieldSavedLocation.innerHTML = [
    '<option value="">Choose a saved location or search a new one</option>',
    ...rows.map((row, index) => `<option value="${index}">${escapeHtml(row.label || row.display_name || row.query || "Saved field")}</option>`),
  ].join("");
  if (previous && rows[Number(previous)]) els.actualFieldSavedLocation.value = previous;
  updateSavedAddressDeleteButton();
}

function updateSavedAddressDeleteButton() {
  const button=document.getElementById('actual-field-delete-location');
  if(button)button.disabled=els.actualFieldSavedLocation.value===''||!readSavedActualFieldLocations()[Number(els.actualFieldSavedLocation.value)];
}
async function deleteSavedActualFieldLocation() {
  const select=els.actualFieldSavedLocation;
  if(select.value==='')return;
  const selected=readSavedActualFieldLocations()[Number(select.value)];
  if(!selected)return;
  const button=document.getElementById('actual-field-delete-location');
  button.disabled=true;select.disabled=true;
  try {
    const response=await fetch('/api/gameframe/field-locations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({delete_label:selected.label})});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'Address could not be deleted.');
    savedFieldLocations=data.locations;
    try{localStorage.setItem(ACTUAL_FIELD_SAVED_LOCATIONS_KEY,JSON.stringify(savedFieldLocations));}catch(error){console.warn('Could not update address cache',error);}
    select.value='';renderSavedActualFieldLocations();
    actualMapSetStatus('Saved address deleted. Your current map marks are kept.');
  } catch(error) {actualMapSetStatus(error.message||'Address could not be deleted.',true);}
  finally{select.disabled=false;updateSavedAddressDeleteButton();}
}
document.getElementById('actual-field-delete-location').addEventListener('click',deleteSavedActualFieldLocation);
els.actualFieldSavedLocation.addEventListener('change',updateSavedAddressDeleteButton);

async function saveActualFieldLocation({ query, displayName, lat, lon }) {
  const cleanQuery = String(query || "").trim();
  const cleanDisplay = String(displayName || cleanQuery || "Saved field").trim();
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
  const label = cleanQuery || cleanDisplay;
  const rows = readSavedActualFieldLocations();
  const duplicateIndex = rows.findIndex((row) => {
    const sameLabel = String(row.label || row.query || row.display_name || "").toLowerCase() === label.toLowerCase();
    const samePoint = Math.abs(Number(row.lat) - latitude) < 0.00002 && Math.abs(Number(row.lon) - longitude) < 0.00002;
    return sameLabel || samePoint;
  });
  const saved = {
    label,
    query: cleanQuery,
    display_name: cleanDisplay,
    lat: latitude,
    lon: longitude,
    saved_at: new Date().toISOString(),
  };
  if (duplicateIndex >= 0) rows.splice(duplicateIndex, 1);
  rows.unshift(saved);
  await writeSavedActualFieldLocations(rows);
  renderSavedActualFieldLocations();
  if (els.actualFieldSavedLocation) els.actualFieldSavedLocation.value = "0";
  updateSavedAddressDeleteButton();
}

function useSavedActualFieldLocation() {
  if (!els.actualFieldSavedLocation?.value) return;
  const rows = readSavedActualFieldLocations();
  const selected = rows[Number(els.actualFieldSavedLocation?.value)];
  if (!selected || !initializeActualFieldMap()) return;
  actualFieldMapState.map.setView([Number(selected.lat), Number(selected.lon)], 18);
  if (els.actualFieldSearch) els.actualFieldSearch.value = selected.query || selected.label || "";
  setActualMapStage("address");
  refreshActualFieldMap();
  actualMapSetStatus(actualMapGuideText(actualFieldMapState.mode));
}

function downsampleCanvasToDataUrl(sourceCanvas, maxWidth = 960, maxHeight = 640, quality = 0.82) {
  const sourceWidth = sourceCanvas.width;
  const sourceHeight = sourceCanvas.height;
  const scale = Math.min(1, maxWidth / Math.max(1, sourceWidth), maxHeight / Math.max(1, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.round(sourceWidth * scale));
  canvas.height = Math.max(2, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d");
  context.fillStyle = "#f0f3f1";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

async function captureActualFieldMapEvidenceImage(target = els.actualFieldMap) {
  if (!target || !window.html2canvas) return null;
  if (target === els.actualFieldMap) actualFieldMapState.map?.invalidateSize({ animate: false });
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  let captureTimeout;
  try {
    const canvas = await Promise.race([window.html2canvas(target, {
      backgroundColor: "#f0f3f1",
      useCORS: true,
      allowTaint: false,
      logging: false,
      imageTimeout: 2500,
      scale: 1,
    }), new Promise(resolve => { captureTimeout = setTimeout(() => resolve(null), 3000); })]);
    return canvas ? downsampleCanvasToDataUrl(canvas) : null;
  } catch (error) {
    console.warn("Could not capture actual field map evidence image", error);
    return null;
  } finally {
    clearTimeout(captureTimeout);
  }
}

let mapEvidenceGeneration = 0;
let pendingMapEvidence = Promise.resolve();
function queueMapEvidenceCapture() {
  const generation = ++mapEvidenceGeneration, signature = workflowMapSignature();
  actualFieldMapState.evidenceImageDataUrl = null;
  if (actualFieldMapState.fieldGeometry) actualFieldMapState.fieldGeometry.evidence_image_data_url = null;
  if (!els.actualFieldMap || !window.html2canvas) { pendingMapEvidence = Promise.resolve(); return; }
  const bounds = els.actualFieldMap.getBoundingClientRect();
  const snapshot = els.actualFieldMap.cloneNode(true);
  snapshot.id = 'actual-field-map-evidence';
  snapshot.setAttribute('aria-hidden', 'true');
  Object.assign(snapshot.style, {position:'fixed',left:'-10000px',top:'0',width:bounds.width+'px',height:bounds.height+'px',pointerEvents:'none',overflow:'hidden'});
  document.body.append(snapshot);
  pendingMapEvidence = captureActualFieldMapEvidenceImage(snapshot).then(image => {
    if (!image || generation !== mapEvidenceGeneration || signature !== workflowMapSignature()) return;
    actualFieldMapState.evidenceImageDataUrl = image;
    if (actualFieldMapState.fieldGeometry) actualFieldMapState.fieldGeometry.evidence_image_data_url = image;
    persistDraft();
  }).catch(error => console.warn('Map image capture skipped', error)).finally(() => snapshot.remove());
}

async function searchActualFieldAddress() {
  const query = String(els.actualFieldSearch?.value || "").trim();
  if (!query) {
    actualMapSetStatus("Enter the exact field address with city and state.", true);
    return;
  }
  if (!initializeActualFieldMap()) return;
  actualMapSetStatus("Searching...");
  if (els.actualFieldSearchButton) els.actualFieldSearchButton.disabled = true;
  try {
    const params = new URLSearchParams({ q: query, format: "jsonv2", limit: "1" });
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Search failed with HTTP ${response.status}`);
    const results = await response.json();
    if (!results.length) {
      actualMapSetStatus("Could not find that address. Try exact street address, city, and state.", true);
      return;
    }
    const hit = results[0];
    actualFieldMapState.map.setView([Number(hit.lat), Number(hit.lon)], 18);
    await saveActualFieldLocation({
      query,
      displayName: hit.display_name,
      lat: hit.lat,
      lon: hit.lon,
    });
    refreshActualFieldMap();
    actualMapSetStatus(actualMapGuideText(actualFieldMapState.mode));
    setActualMapStage("points");
  } catch (error) {
    actualMapSetStatus(error.message || "Search failed.", true);
  } finally {
    if (els.actualFieldSearchButton) els.actualFieldSearchButton.disabled = false;
  }
}

let workflowMapSnapshot = null;
function workflowMapSignature() {
  const map = actualFieldMapState;
  return JSON.stringify([map.camera, map.home, map.axis, map.distanceFt, map.signedDirectionDeg, els.cameraHeightFt?.value, state.distanceCertainty]);
}

let actualMapConfirmBusy = false;
async function applyActualFieldMapValues({ continueAfter = false } = {}) {
  if (actualMapConfirmBusy) return false;
  if (!document.querySelector('input[name="landing-certainty"]:checked')) {
    actualMapSetStatus('Choose how sure you are where the ball first landed.', true);
    return false;
  }
  const state = actualFieldMapState;
  if (!state.camera || !state.home || !state.axis || !Number.isFinite(state.distanceFt) || !Number.isFinite(state.signedDirectionDeg)) {
    actualMapSetStatus("Mark camera position, home plate, second base or rubber, and landing spot before continuing.", true);
    return false;
  }
  actualMapConfirmBusy = true;
  const controls = [els.actualMapContinue, els.actualMapBackDiagram, document.getElementById('actual-map-reset'), document.getElementById('actual-map-keep-original')].filter(Boolean);
  const previousDisabled = controls.map(control => control.disabled);
  const previousLabel = els.actualMapContinue.textContent;
  controls.forEach(control => { control.disabled = true; });
  els.actualMapContinue.classList.add('is-loading');
  els.actualMapContinue.textContent = 'Saving...';
  els.actualMapContinue.setAttribute('aria-busy', 'true');
  document.getElementById('actual-map-confirm-status').hidden = false;
  try {
  await nextPaint();
  if (els.direction) els.direction.value = directionValueFromSignedAngle(state.signedDirectionDeg);
  actualMapUpdateMeasurements();
  queueMapEvidenceCapture();
  setCameraMarkerFromMapPoints(state.camera, state.home, state.axis);
  setLandingMarkerFromDistanceDirection(state.distanceFt, state.signedDirectionDeg);
  markPredictionStale();
  updateEstimateBanner();
  persistDraft();
  actualMapSetStatus(`Using ${Math.round(state.distanceFt)} ft and ${formatActualMapDirection(state.signedDirectionDeg)}.`);
  closeActualFieldMapModal();
  if (continueAfter) goToWorkflowStep("contact");
  return true;
  } finally {
    actualMapConfirmBusy = false;
    controls.forEach((control, index) => { control.disabled = previousDisabled[index]; });
    els.actualMapContinue.classList.remove('is-loading');
    els.actualMapContinue.textContent = previousLabel;
    els.actualMapContinue.removeAttribute('aria-busy');
    document.getElementById('actual-map-confirm-status').hidden = true;
  }
}

function moveSetupControlsToSlot(slot) {
  if (!slot || !els.setupControls || els.setupControls.parentElement === slot) return;
  slot.appendChild(els.setupControls);
  setFieldToolExpanded(false);
  setMarkerPosition("camera", markers.camera.x, markers.camera.y);
  setMarkerPosition("landing", markers.landing.x, markers.landing.y);
}

function moveViewerToWorkflow(enabled) {
  if (enabled) {
    if (els.viewerPanel.parentElement !== els.workflowViewerSlot) {
      els.workflowViewerSlot.appendChild(els.viewerPanel);
    }
    els.workflowViewerSlot.hidden = false;
    els.setupModal.classList.add("workflow-video-modal");
  } else {
    if (els.viewerPanel.parentElement !== viewerHome) {
      viewerHome.insertBefore(els.viewerPanel, viewerPlaceholder);
    }
    els.workflowViewerSlot.hidden = true;
    els.setupModal.classList.remove("workflow-video-modal");
  }
  requestAnimationFrame(syncCanvasSize);
}

const markingPromptState = new WeakMap();
const markingPromptSurfaces = new WeakSet();
const markingPromptDurationMs = 2800;

function dismissMarkingPrompt(prompt, reset = false) {
  const current = markingPromptState.get(prompt);
  if (current) clearTimeout(current.timer);
  prompt.hidden = true;
  if (reset) markingPromptState.delete(prompt);
}

function dismissMarkingPrompts(surface) {
  surface?.querySelectorAll(".marking-prompt").forEach(prompt => dismissMarkingPrompt(prompt));
}

function flashMarkingPrompt(prompt, message) {
  const previous = markingPromptState.get(prompt);
  if (previous?.message === message) return;
  if (previous) clearTimeout(previous.timer);
  prompt.textContent = message;
  prompt.hidden = false;
  prompt.style.animation = "none";
  void prompt.offsetWidth;
  prompt.style.animation = "";
  const timer = setTimeout(() => { prompt.hidden = true; }, markingPromptDurationMs);
  markingPromptState.set(prompt, {message, timer});
  const surface = prompt.closest(".viewer-panel") || prompt.parentElement;
  if (surface && !markingPromptSurfaces.has(surface)) {
    markingPromptSurfaces.add(surface);
    surface.addEventListener("pointerdown", () => dismissMarkingPrompts(surface), true);
    surface.addEventListener("wheel", () => dismissMarkingPrompts(surface), {passive:true});
  }
}

function setWorkflowVideoPrompt(message = "") {
  let prompt = els.viewerPanel?.querySelector(".workflow-video-prompt");
  if (!message) {
    if (prompt) dismissMarkingPrompt(prompt, true);
    return;
  }
  if (activeWorkflowStep !== "contact") els.setupTitle.textContent = activeWorkflowStep === 'landmarks' ? 'Check field marks' : message;
  if (!prompt) {
    prompt = document.createElement("div");
    prompt.className = "workflow-video-prompt marking-prompt";
    prompt.setAttribute("role", "status");
    prompt.setAttribute("aria-live", "polite");
    els.viewerPanel.querySelector(".viewer").appendChild(prompt);
  }
  flashMarkingPrompt(prompt, message);
}

const workflowSteps = ["geometry", "contact", "ballPath", "landmarks", "groundChoice", "ground", "player"];

const workflowCopy = {
  geometry: {
    title: "Field Map",
    action: "Continue To Contact",
  },
  contact: {
    title: "Mark contact",
    action: "Tag the ball at contact",
  },
  landmarks: {
    title: "Field Landmarks",
    action: "Continue To Ground Contact",
  },
  ballPath: {
    title: "Ball Path",
    action: "Continue To Field Marks",
  },
  ground: {
    title: "Ground Contact",
    action: "Use Ground Contact",
  },
  groundChoice: {
    title: "Can you see the ball first touch the ground?",
    action: "I can see first ground contact",
  },
  player: {
    title: "Prediction and Video",
    action: "Save hit",
  },
};

let activeWorkflowStep = "geometry";
let workflowExportRunning = false;
let workflowPreparingExport = false;
let workflowExportComplete = false;
let workflowPredictionAbortController = null;
let backgroundPredictionPromise = null;
let backgroundPredictionAbortController = null;
let livePredictionController = null;
let livePredictionGeneration = 0;
let preparedClipBuild = null;
let filePickerStartOverApproved = false;
let workflowDetailsConfirmed = false;
let workflowReviewRequested = false;
let workflowError = "";

let workflowLandmarkReview = false;

function contactMarkingPrompt() {
  return state.contactTimingChoice === "BETWEEN_FRAMES"
    ? "Show the first frame after contact, then click the ball"
    : "Find the contact frame and click the contact point on the bat";
}

let contactSuggestionBusy=false;
function ensureWorkflowContactSuggestion() {
  if (activeWorkflowStep !== "contact" || state.contactTime !== null ||
      state.ballPathAudioStarted || !state.videoFile || !els.video.readyState) return;
  state.ballPathAudioStarted = true;
  suggestWorkflowContact(true);
}

async function suggestWorkflowContact(auto = true) {
  const file = state.videoFile;
  const button = document.getElementById("workflow-find-contact");
  const status = document.getElementById("workflow-contact-suggestion");
  if (button?.disabled) return;
  contactSuggestionBusy=true;els.setupModal.dataset.contactFinding='true';
  setWorkflowVideoPrompt('');els.setupTitle.textContent='Finding likely contact… please wait';
  if (button) { button.disabled = true; button.classList.add("is-loading"); }
  if (status) status.textContent = "Finding likely contact...";
  try {
    await detectContactFromAudio({auto});
    if (file !== state.videoFile || activeWorkflowStep !== "contact") return;
    if (status?.isConnected) status.textContent = els.contactAudioStatus.textContent.startsWith("Audio jumped")
      ? "Suggested frame. Check it, then click the ball."
      : "Use the frame buttons to find contact.";
    setWorkflowVideoPrompt(contactMarkingPrompt());
  } finally {
    contactSuggestionBusy=false;delete els.setupModal.dataset.contactFinding;
    if(file===state.videoFile&&activeWorkflowStep==='contact')els.setupTitle.textContent='Check the suggested frame and mark contact';
    if (button?.isConnected) { button.disabled = false; button.classList.remove("is-loading"); }
  }
}

function workflowFrameNavigationAllowed() {
  if(activeWorkflowStep==='ballPath'&&nativeBallAssist.phase==='review')return false;
  return ["contact", "landmarks", "ballPath", "ground"].includes(activeWorkflowStep);
}

function workflowStepIndex(step = activeWorkflowStep) {
  return Math.max(0, workflowSteps.indexOf(step));
}

// Navigation only changes the view. Existing marks are never re-saved to advance.
function workflowNavigationItems() {
  const contact = state.contactTime !== null;
  const ball = ballDetectionSeedReadiness().ready;
  const field = requiredVideoLandmarksReady();
  return [
    {step: "geometry", label: "Map", enabled: true},
    {step: "contact", label: "Contact", enabled: actualFieldMapGeometryReady()},
    {step: "ballPath", label: "Ball marks", enabled: contact},
    {step: "landmarks", label: "Field marks", enabled: contact && ball},
    {step: "ground", label: "Ground contact", enabled: contact && ball && field},
    {step: "player", label: "Review", enabled: contact && ball && field},
  ];
}

async function navigateWorkflow(step) {
  if (workflowPreparingExport || workflowExportRunning || actualMapConfirmBusy) return;
  const item = workflowNavigationItems().find(item => item.step === step);
  if (!item?.enabled) return;
  if (step === "player" && activeWorkflowStep === "player" && backgroundPredictionPromise) return backgroundPredictionPromise;
  cancelWorkflowPrediction();
  if (step === "geometry") {
    openSetupModal("geometry");
  } else {
    if (els.actualFieldMapModal?.open) {
      if (workflowMapSnapshot !== workflowMapSignature()) {
        if (!await applyActualFieldMapValues()) return;
      } else closeActualFieldMapModal();
    }
    if (step === "player") {
      workflowReviewRequested = true;
      workflowError = "";
    }
    goToWorkflowStep(step);
    if (step === "ground" && state.terminalEvent) seekVideoTo(state.terminalEvent.video_time_s);
    if (step === "player" && !state.latestPrediction) {
      await startBackgroundPrediction("review requested");
      if (activeWorkflowStep === "player" && !state.latestPrediction && !backgroundPredictionPromise) {
        workflowError = "Could not build the review. " + (els.predictionUnconstrained?.textContent || "Check the field map and ball marks, then try again.");
        renderWorkflowStep("player");
      }
    }
  }
}

function renderWorkflowNavigation(current = activeWorkflowStep) {
  for (const id of ["setup-modal", "actual-field-map-modal"]) {
    const modal = document.getElementById(id);
    if (!modal) continue;
    let nav = modal.querySelector(".workflow-navigation");
    if (!nav) {
      nav = document.createElement("nav");
      nav.className = "workflow-navigation";
      nav.setAttribute("aria-label", "Hit setup screens");
      modal.querySelector(".setup-heading").appendChild(nav);
    }
    nav.replaceChildren();
    const restart = document.createElement("button");
    restart.type = "button";
    restart.textContent = "Start over";
    restart.className = "workflow-start-over";
    restart.disabled = workflowPreparingExport || workflowExportRunning || actualMapConfirmBusy;
    restart.addEventListener("click", () => {
      if(id === 'actual-field-map-modal' && ['points','confirm'].includes(actualMapStage)) {
        actualMapResetPoints();setActualMapStage('points');
      } else restartWorkflow();
    });
    nav.appendChild(restart);
    if(id==='setup-modal'&&current==='landmarks'){
      const actions=document.createElement('span');actions.className='native-auto-controls workflow-field-controls';
      for(const original of els.setupControlsSlot.querySelectorAll('button')){
        const button=original.cloneNode(true);
        button.id=original.id+'-top';button.hidden=false;
        if(original.id==='workflow-use-field-suggestions'||original.id==='workflow-confirm-field-marks')button.classList.add('primary');
        button.addEventListener('click',()=>original.click());
        original.hidden=true;actions.append(button);
      }
      nav.prepend(actions);
      els.setupControlsSlot.hidden=!els.setupControlsSlot.querySelector('p,[role="status"]');
    }
    if(id==='setup-modal'&&current==='ballPath'&&['running','review'].includes(nativeBallAssist.phase)){
      const controls=document.createElement('span');controls.className='native-auto-controls';
      controls.innerHTML=nativeBallAssist.phase==='running'
        ? '<span id="native-auto-progress" role="status"></span><button id="native-auto-manual" type="button">Tag manually</button>'
        : '<button id="native-auto-yes" type="button">Yes, continue</button><button id="native-auto-manual" type="button">No, tag manually</button>';
      controls.querySelector('#native-auto-manual').onclick=useRegularIntervalTagging;
      const yes=controls.querySelector('#native-auto-yes');if(yes)yes.onclick=acceptNativeBallAssist;
      nav.prepend(controls);
    }
    if (id === "setup-modal" && ["contact", "ballPath", "landmarks"].includes(current) && !(current === 'ballPath' && ['running','review'].includes(nativeBallAssist.phase)) && (current !== "ballPath" || ballDetectionSeedReadiness().markKey)) {
      const skip = document.createElement("button");
      skip.type = "button";
      skip.className = "workflow-not-visible";
      skip.textContent = "Not visible";
      skip.addEventListener("click", skipCurrentVideoMark);
      nav.prepend(skip);
    }
  }
}

let estimateExplanationOpen = false;
function measurementSupportMarkup() {
  const match = state.latestPrediction?.direction_first_match;
  const ranges = match?.supported_ranges?.exit_velocity_mph ? match.supported_ranges : state.latestPrediction?.measurement_support;
  if (!ranges?.exit_velocity_mph || !ranges?.launch_angle_deg) return "";
  const show = (values,unit) => `${values[0].toFixed(1)}–${values[1].toFixed(1)} ${unit}`;
  const best = match?.best;
  const sensitivity = state.latestPrediction?.launch_angle_uncertainty;
  const landingAllowance=match?.selection_policy?.distance_tolerance_ft;
  const angleText = ranges.launch_angle_deg[1] - ranges.launch_angle_deg[0] < 0.1
    ? `Estimated launch angle ${Math.round(best?.launch_angle_deg ?? ranges.launch_angle_deg[0])}°`
    : show(ranges.launch_angle_deg,"°");
  const sensitivityExplanation = sensitivity?.range_deg
    ? `<p>Separately, varying camera geometry, direction and marking accuracy gives an angle sensitivity envelope of ${show(sensitivity.range_deg,"°")}. These endpoints are not necessarily flights that fit your marks. The fitted angle and speed range assume the current geometry; they are not guaranteed accuracy intervals.</p>` : '';
  const selectedExplanation = best?.score_policy === "early_geometry_then_late_height"
    ? `<p>${escapeHtml(plainEstimateExplanation(best, state.latestPrediction))} This range describes model sensitivity, not a guaranteed accuracy interval.</p>`
    : best?.score_policy === "joint_path_and_distance"
    ? `<p>Selected ${formatNumber(best.exit_velocity_mph, 1, " mph")} at ${formatNumber(best.launch_angle_deg, 1, "°")}: this flight has the lowest combined error against your timed ball marks and landing distance. Its landing distance is ${formatNumber(best.distance_ft, 1, " ft")}, compared with your ${formatNumber(match.selection_policy?.target_distance_ft, 0, " ft")} mark. Other flights in the range also fit within the allowed errors; the selected values are not exact measurements.</p>`
    : `<p>${escapeHtml(best ? plainEstimateExplanation(best,state.latestPrediction) : 'Field marks and camera position establish the viewing geometry. The marked ball positions and landing information constrain which modeled flights remain plausible. Results depend on the accuracy and uncertainty of those inputs.')}</p>`;
  return `<section class="workflow-card workflow-compact-card"><strong>Flights that fit your marks</strong>
    <p>${show(ranges.exit_velocity_mph,"mph")} · ${angleText}</p>
    ${usesDescentRate(state.latestPrediction)?`<p class="muted">Camera-corrected descent rate constrains this model range within your ±${formatNumber(landingAllowance,0,' ft')} landing allowance. The allowance is an input limit, not a fixed EV margin. Results remain conditional on the camera geometry.</p>`:state.latestPrediction?.launch_angle_uncertainty ? '<p class="muted">Speed range assumes the fitted camera setup and contact position. Launch angle is calculated from the early path. Camera and direction sensitivity is explained below.</p>' : ''}
    <section class="workflow-estimate-explanation"><button type="button" id="workflow-estimate-toggle" aria-controls="workflow-estimate-explanation-body" aria-expanded="${estimateExplanationOpen}">How the estimate works</button><div id="workflow-estimate-explanation-body" class="workflow-estimate-explanation-body" ${estimateExplanationOpen?'':'hidden'}><p>GameFrame compares your video observations with modeled hit trajectories to estimate exit velocity, launch angle and distance.</p>${selectedExplanation}${sensitivityExplanation}</div></section>
</section>`;
}

function workflowStatusLine() {
  const pieces = [];
  pieces.push(state.contactTime === null ? "contact not set" : `contact ${round(state.contactTime, 3).toFixed(3)} s`);
  pieces.push(`${state.landmarks.length} landmark${state.landmarks.length === 1 ? "" : "s"}`);
  pieces.push(`${state.autoObservations.length} detected path point${state.autoObservations.length === 1 ? "" : "s"}`);
  return pieces.join("  /  ");
}

function setupWorkflowButton(id, handler) {
  const button = document.getElementById(id);
  if (button) button.addEventListener("click", handler);
}

function applyWorkflowTerminalControls() {
  const terminalType = document.getElementById("workflow-terminal-type");
  const terminalUncertainty = document.getElementById("workflow-terminal-uncertainty");
  if (terminalType) els.terminalType.value = terminalType.value;
  if (terminalUncertainty) els.terminalUncertaintyFrames.value = terminalUncertainty.value;
}

function wizardEditingActive() {
  return Boolean(els.setupModal?.open && ["contact", "landmarks", "ballPath", "ground"].includes(activeWorkflowStep));
}

function renderWorkflowStep(step = activeWorkflowStep) {
  const focused = document.activeElement;
  const preserveFocus = step === 'player' && activeWorkflowStep === 'player' && focused?.id?.startsWith('workflow-');
  const selection = preserveFocus && focused.tagName === 'TEXTAREA' ? [focused.selectionStart, focused.selectionEnd] : null;
  try {
    renderWorkflowStepContent(step);
  } finally {
    if(['landmarks','groundChoice','ground','apexChoice','apex','player','prediction'].includes(step))scheduleEarlyEstimatePreparation();
    renderWorkflowNavigation(step);
    els.setupBack.disabled = workflowPreparingExport || workflowExportRunning;
    if (els.setupCancel) els.setupCancel.disabled = workflowPreparingExport || workflowExportRunning;
    if (preserveFocus) {
      const replacement = document.getElementById(focused.id);
      replacement?.focus({preventScroll:true});
      if (selection && replacement) replacement.setSelectionRange(...selection);
    }
    if (workflowExportRunning || workflowPreparingExport) {
      els.setupContinue.disabled = true;
      els.setupContinue.classList.add("is-loading");
      els.setupContinue.textContent = "Saving hit...";
    }
  }
}

function renderWorkflowStepContent(step = activeWorkflowStep) {
  els.setupControlsSlot.hidden=false;
  activeWorkflowStep = step;
  const actions = els.setupModal.querySelector(".setup-actions");
  const heading = els.setupModal.querySelector(".setup-heading");
  if (actions && heading) {
    if (step === "groundChoice") heading.after(actions);
    else heading.appendChild(actions);
  }
  const index = workflowStepIndex(step);
  const meta = workflowCopy[step] || workflowCopy.geometry;
  els.setupModal.classList.toggle("geometry-modal", step === "geometry");
  els.setupModal.classList.toggle("workflow-wide-modal", step === "player");
  els.setupModal.classList.remove("workflow-details-only");
  els.setupModal.classList.toggle("workflow-building", step === "player");
  els.setupModal.classList.toggle("workflow-busy", workflowPreparingExport || workflowExportRunning);
  els.setupModal.dataset.step = step;
  els.setupModal.dataset.ballAssistPhase = step==='ballPath'&&['running','review'].includes(nativeBallAssist.phase)?nativeBallAssist.phase:'';
  els.setupModal.dataset.landmarkReview = String(step === "landmarks" && workflowLandmarkReview);
  els.setupModal.classList.toggle("workflow-video-only-modal", ["contact", "landmarks", "ballPath", "ground"].includes(step));
  moveViewerToWorkflow(["contact", "landmarks", "ballPath", "ground"].includes(step));
  syncGroundView(step);
  setWorkflowVideoPrompt("");
  els.setupTitle.textContent = meta.title;
  els.setupCopy.textContent = "";
  els.setupCopy.hidden = true;
  els.setupStepLabel.hidden = true;
  els.setupStepLabel.textContent = `Step ${index + 1} of ${workflowSteps.length}`;
  els.setupBack.hidden = true;
  if (els.setupCancel) {
    els.setupCancel.textContent = "Exit Wizard";
    els.setupCancel.hidden = true;
  }
  if (els.setupSecondary) {
    els.setupSecondary.hidden = true;
    els.setupSecondary.textContent = "";
  }
  els.setupContinue.textContent = meta.action;
  els.setupContinue.hidden = ["contact", "landmarks", "ballPath"].includes(step);
  els.setupBack.hidden = true;
  els.setupCancel.hidden = true;
  els.viewerPanel.querySelector(".transport").hidden = !workflowFrameNavigationAllowed();
  if (["contact", "landmarks", "ballPath", "ground"].includes(step)) els.video.pause();
  els.setupContinue.disabled = false;
  els.setupContinue.classList.remove("is-loading");
  if (step === "export") {
    if (workflowExportRunning) {
      els.setupContinue.disabled = true;
      els.setupContinue.classList.add("is-loading");
      els.setupContinue.textContent = "Saving hit...";
    } else if (workflowExportComplete) {
      els.setupContinue.textContent = "Close";
    }
  }
  if (step === "geometry") {
    moveSetupControlsToSlot(els.setupControlsHome);
    els.setupControlsSlot.innerHTML = "";
    return;
  }

  moveSetupControlsToSlot(els.setupControlsHome);
  els.setupControlsSlot.innerHTML = "";

  if (step === "contact") {
    setClickMode("ball");
    if (state.contactTime !== null) seekVideoTo(contactCalibrationTime());
    setWorkflowVideoPrompt(contactMarkingPrompt());
    els.setupControlsSlot.innerHTML = `<div class="workflow-contact-toolbar">
      <label>Contact <select id="workflow-contact-timing" aria-label="Contact timing">
        <option value="ON_FRAME" ${state.contactTimingChoice === "ON_FRAME" ? "selected" : ""}>On this frame</option>
        <option value="BETWEEN_FRAMES" ${state.contactTimingChoice === "BETWEEN_FRAMES" ? "selected" : ""}>Between frames</option>
      </select></label>
      <button id="workflow-find-contact" type="button">Find contact</button>
      <span id="workflow-contact-suggestion" role="status"></span>
    </div>`;
    document.getElementById("workflow-contact-timing").addEventListener("change", event => {
      state.contactTimingChoice = event.target.value;
      setWorkflowVideoPrompt(contactMarkingPrompt());
    });
    setupWorkflowButton("workflow-find-contact", () => suggestWorkflowContact(false));
    ensureWorkflowContactSuggestion();
    els.setupContinue.hidden = state.contactTime === null;
    els.setupContinue.textContent = "Next: Ball marks";
    return;
  }

  if (step === "landmarks") {
    if (state.contactTime !== null) seekVideoTo(contactCalibrationTime());
    setClickMode("landmark");
    const nextLandmark = nextRequiredVideoLandmark();
    if (nextLandmark && !workflowLandmarkReview) els.landmarkType.value = nextLandmark;
    if (!nextLandmark && !LANDMARK_SEQUENCE.includes(els.landmarkType.value)) {
      els.landmarkType.value = "home_plate";
    }
    setWorkflowVideoPrompt(videoLandmarkPrompt(els.landmarkType.value));
    els.setupControlsSlot.innerHTML = "";
    els.setupContinue.hidden = true;
    els.setupContinue.textContent = "Use field marks";
    els.setupCancel.hidden = true;
    els.setupContinue.disabled = !requiredVideoLandmarksReady();
    if (fieldSuggestionLoading || state.pendingLandmarks.length) {
      setWorkflowVideoPrompt(fieldSuggestionLoading ? 'Finding field lines, home plate and the rubber…'
        : 'Check the suggested field marks. Drag any marker to correct it, then choose "Confirm field marks".');
      els.setupControlsSlot.innerHTML = `${state.pendingLandmarks.length ? '<button type="button" id="workflow-use-field-suggestions">Confirm field marks</button>' : ''}<button type="button" id="workflow-manual-field">Tag manually</button>`;
      setupWorkflowButton('workflow-use-field-suggestions', () => {
        acceptLandmarkSuggestions();
        workflowLandmarkReview = requiredVideoLandmarksReady();
        if (workflowLandmarkReview) goToWorkflowStep('groundChoice');
        else renderWorkflowStep('landmarks');
      });
      setupWorkflowButton('workflow-manual-field', () => {
        dismissedFieldSuggestionKey = contactPreloadKey();
        fieldSuggestionLoading = false;
        rejectLandmarkSuggestions();
        renderWorkflowStep('landmarks');
      });
      return;
    }
    els.setupControlsSlot.innerHTML = `<p role="status">${escapeHtml(fieldSuggestionMessage || 'Automatically suggest field marks, or click the video to mark them yourself.')}</p><button type="button" id="workflow-detect-field">Detect field marks</button>`;
    setupWorkflowButton('workflow-detect-field', () => {
      dismissedFieldSuggestionKey = null;
      void suggestFieldLandmarks();
    });
    if (workflowLandmarkReview) {
      setWorkflowVideoPrompt('Review the field marks. Click a marker to select it, then click its corrected position.');
      els.setupControlsSlot.insertAdjacentHTML('beforeend','<button type="button" id="workflow-confirm-field-marks">Confirm field marks</button>');
      setupWorkflowButton('workflow-confirm-field-marks', () => goToWorkflowStep('groundChoice'));
    }
    return;
  }

  if (step === "ballPath") {
    if (['running','review'].includes(nativeBallAssist.phase)) {renderNativeBallAssist();return;}
    if (!["ball", "eraser"].includes(els.clickMode.value)) {
      setClickMode("ball");
    }
    const detectionReadiness = ballDetectionSeedReadiness();
    els.setupContinue.hidden = !detectionReadiness.ready;
    els.setupContinue.textContent = "Continue to field marks";
    setWorkflowVideoPrompt(detectionReadiness.message);
    if (detectionReadiness.frameGap) {
      seekVideoTo(adjacentFrameTime(detectionReadiness.frameGap, contactCalibrationTime()));
    }
    if (detectionReadiness.phase === "needs_contact_ball" && state.contactTime !== null && Math.abs((els.video.currentTime || 0) - state.contactTime) > currentStep() * 0.65) {
      seekVideoTo(contactCalibrationTime());
    }
    if (state.autoObservations.length === 0) {
      state.showAutoTrack = false;
      els.showAutoTrack.checked = false;
    }
    els.setupControlsSlot.innerHTML = "";
    return;
  }

  if (step === "groundChoice") {
    els.setupSecondary.hidden = false;
    els.setupSecondary.textContent = "No";
    els.setupContinue.textContent = "Yes";
    els.setupBack.hidden = true;
    els.setupCancel.hidden = true;
    return;
  }

  if (step === "ground") {
    setClickMode("terminal");
    setWorkflowVideoPrompt("Find the first frame where the ball touches the ground");
    if (els.setupSecondary) {
      els.setupSecondary.hidden = false;
      els.setupSecondary.textContent = "Ground contact not visible";
    }
    els.setupContinue.textContent = "Use This Frame";
    els.setupControlsSlot.innerHTML = "";
    return;
  }

  if (step === "player") {
    els.setupTitle.textContent = state.latestPrediction?.distance_review?.required ? 'Review the match' : 'Prediction and Video';
    const best = practicalEstimate();
    const canPredict = state.observations.length >= 2 && !state.skippedVideoMarks?.includes("contact");
    const exportBlocker = predictionExportBlocker();
    els.setupControlsSlot.innerHTML = `
      ${workflowError ? `<p role="alert" class="workflow-warning">${escapeHtml(workflowError)}</p>` : ""}
      ${!state.latestPrediction ? '<p role="status">Calculating prediction…</p>' : ""}
      ${distanceHangEvidenceMarkup()}
      ${measurementSupportMarkup()}
      ${state.latestPrediction?.distance_review ? distanceReviewMarkup() : needsLandingReview() ? `<section class="landing-review-notice" role="status"><p>${escapeHtml(landingReviewText())}</p><div class="button-row"><button id="review-landing-point" type="button">Adjust landing point</button><button id="keep-landing-point" type="button">Keep my mark</button></div></section>` : ''}
      ${!workflowDetailsConfirmed && !state.latestPrediction?.distance_review?.required ? exportReadinessMarkup() : ""}
      <div class="workflow-card workflow-final-layout">
        <div class="workflow-export-combined">
          <div id="workflow-prediction-working" class="workflow-working" hidden>
            <progress id="workflow-prediction-progress-bar" value="0" max="1"></progress>
            <span id="workflow-prediction-working-text">Building prediction...</span>
          </div>
          <div id="workflow-export-progress" class="clip-progress" ${els.clipProgressWrap?.hidden ? "hidden" : ""}>
            <progress id="workflow-export-progress-bar" value="${escapeHtml(String(els.clipProgress?.value || 0))}" max="1"></progress>
            <span id="workflow-export-progress-text">${escapeHtml(els.clipProgressText?.textContent || "")}</span>
          </div>
          ${canPredict ? "" : `<div class="workflow-warning">Not enough visible ball marks to estimate EV. A visible contact position and at least one later ball position are required.</div>`}
          ${state.latestPrediction ? `
            <div class="workflow-prediction-grid">
              <div class="prediction-card">${els.predictionUnconstrained?.innerHTML || ""}</div>
              <div class="flight-viewer workflow-flight-viewer">
                <canvas id="workflow-flight-canvas" aria-label="Preview of the matched synthetic flight"></canvas>
                <div class="flight-hud">${best ? escapeHtml(plainEstimateText()) : ""}</div>
              </div>
            </div>
            ${exportReadinessMarkup()}
          ` : ""}
        </div>
      </div>
    `;
    if (!canPredict || (state.latestPrediction && exportBlocker)) {
      els.setupContinue.disabled = true;
    }
    setupWorkflowButton('workflow-estimate-toggle', () => {
      estimateExplanationOpen = !estimateExplanationOpen;
      document.getElementById('workflow-estimate-explanation-body').hidden = !estimateExplanationOpen;
      document.getElementById('workflow-estimate-toggle').setAttribute('aria-expanded',String(estimateExplanationOpen));
    });
    setupWorkflowButton('edit-map-marks', openLandingReview);
    setupWorkflowButton('review-landing-point', openLandingReview);
    setupWorkflowButton('compare-match-map', openMapComparison);
    setupDistanceReview();
    setupWorkflowButton('keep-landing-point', () => {
      landingReviewAcknowledged = state.latestPrediction;
      renderWorkflowStep('player');
    });
    renderWorkflowFlightPreview();
    // Review stays lightweight. Encode only after the user chooses "Save hit".
    return;
  }

  if (step === "prediction") {
    const best = practicalEstimate();
    const canPredict = state.observations.length >= 2 && !state.skippedVideoMarks?.includes("contact");
    const exportBlocker = predictionExportBlocker();
    if (!canPredict) els.setupContinue.disabled = true;
    else els.setupContinue.disabled = false;
    els.setupControlsSlot.innerHTML = `
      <div class="workflow-card workflow-prediction-card">
        <div class="workflow-status">${escapeHtml(workflowStatusLine())}</div>
        <div id="workflow-prediction-working" class="workflow-working" hidden>
          <progress id="workflow-prediction-progress-bar" value="0" max="1"></progress>
          <span id="workflow-prediction-working-text">Building prediction...</span>
        </div>
        ${canPredict ? "" : `<div class="workflow-warning">Add at least two ball points before building prediction.</div>`}
        <div class="workflow-prediction-grid">
          <div class="prediction-card">${els.predictionUnconstrained?.innerHTML || "Prediction has not been built yet."}</div>
          <div class="flight-viewer workflow-flight-viewer">
            <canvas id="workflow-flight-canvas" aria-label="Preview of the matched synthetic flight"></canvas>
            <div class="flight-hud">${best ? escapeHtml(plainEstimateText()) : "Build prediction to preview the matched simulated flight."}</div>
          </div>
        </div>
        ${exportReadinessMarkup()}
        <div id="workflow-export-progress" class="clip-progress" ${els.clipProgressWrap?.hidden ? "hidden" : ""}>
          <progress id="workflow-export-progress-bar" value="${escapeHtml(String(els.clipProgress?.value || 0))}" max="1"></progress>
          <span id="workflow-export-progress-text">${escapeHtml(els.clipProgressText?.textContent || "")}</span>
        </div>
      </div>
    `;
    if (state.latestPrediction && exportBlocker) {
      els.setupContinue.disabled = true;
    }
    renderWorkflowFlightPreview();
    return;
  }

  if (step === "export") {
    const best = practicalEstimate();
    const exportBlocker = predictionExportBlocker();
    els.setupControlsSlot.innerHTML = `
      <div class="workflow-card">
        <div class="workflow-status">${escapeHtml(workflowStatusLine())}</div>
        <strong>${escapeHtml(best ? plainEstimateText() : "Prediction not built yet")}</strong>
        <p class="hint">Export downloads the generated video and saves the hit data, markings, prediction, source trim, and generated video in the local GameFrame database.</p>
        ${exportReadinessMarkup()}
        <div id="workflow-export-progress" class="clip-progress" ${els.clipProgressWrap?.hidden ? "hidden" : ""}>
          <progress id="workflow-export-progress-bar" value="${escapeHtml(String(els.clipProgress?.value || 0))}" max="1"></progress>
          <span id="workflow-export-progress-text">${escapeHtml(els.clipProgressText?.textContent || "")}</span>
        </div>
      </div>
    `;
    if (exportBlocker) {
      els.setupContinue.disabled = true;
    }
    return;
  }
}

function renderWorkflowFlightPreview() {
  const workflowCanvas = document.getElementById("workflow-flight-canvas");
  if (!workflowCanvas || !els.flightCanvas) return;
  const originalCanvas = els.flightCanvas;
  els.flightCanvas = workflowCanvas;
  try {
    renderFlightView();
  } finally {
    els.flightCanvas = originalCanvas;
  }
}

function goToWorkflowStep(step) {
  if (step === 'landmarks') scheduleContactPreload();
  if (step === "landmarks" && state.contactTime === null) step = "contact";
  if (step === "landmarks" && !ballDetectionSeedReadiness().ready) step = "ballPath";
  if (step === "landmarks") workflowLandmarkReview = requiredVideoLandmarksReady();
  renderWorkflowStep(step);
  if (step === "player") startBackgroundPrediction("player details opened");
  if (els.setupModal?.showModal && !els.setupModal.open) {
    document.body.classList.add("setup-modal-open");
    els.setupModal.showModal();
  }
}

function cancelWorkflowPrediction() {
  clearTimeout(earlyEstimateTimer);
  earlyEstimatePreparation?.cancel();
  earlyRegistrationPreparation?.cancel();
  if (workflowPredictionAbortController) {
    workflowPredictionAbortController.abort();
    workflowPredictionAbortController = null;
  }
  cancelBackgroundPrediction();
}

function startWorkflowSaveProgress() {
  let message = 'Saving your measurement and preserving its source clip...', started = Date.now();
  const render = () => {
    const seconds = Math.floor((Date.now() - started) / 1000);
    setClipProgress(null, message + (seconds >= 3 ? ` (${seconds} seconds)` : ''));
  };
  render();
  const timer = setInterval(render, 1000);
  return {
    stage(text) { message = text; started = Date.now(); render(); },
    stop() { clearInterval(timer); },
  };
}

async function runWorkflowExport() {
  if (workflowExportRunning) return;
  workflowExportRunning = true;
  workflowExportComplete = false;
  els.setupContinue.disabled = true;
  els.setupContinue.classList.add("is-loading");
  els.setupContinue.textContent = "Saving hit...";
  const progress = startWorkflowSaveProgress();
  try {
    await nextPaint();
    const saved=await saveHitTrack({deferVideo:true});
    workflowExportComplete=Boolean(saved?.measurement_persisted||saved?.video_persisted);
    if (!workflowExportComplete) workflowError = els.clipProgressText?.textContent || "The hit could not be saved. Your draft is still available.";
    if (workflowExportComplete) {
      state.gameframe.libraryNotice = evSaveCompletionMessage();
      window.GameFrameEvVideoNotifications.track(state.gameframe.savedHitId,state.gameframe.videoRenderStatus);
      await window.GameFrameEvDrafts?.clear();
      if (!state.gameframe.pendingSwingId && state.gameframe.copyReadyPromise) {
        els.setupContinue.textContent = 'Preparing swing timing...';
        progress.stage('Hit saved. Preparing swing timing. Your EV video is rendering in the background.');
        await state.gameframe.copyReadyPromise;
      }
      setClipProgress(1, 'Hit saved. Opening swing timing...');
      closeSetupModal();
      if (state.gameframe.pendingSwingId) openSavedSwingTiming(state.gameframe.pendingSwingId);
      else openSharedLibrary();
    }
  } catch(error) {
    workflowError=error.message||'Could not save this measurement. Your draft is still available.';
    setClipProgress(0,workflowError);
  } finally {
    progress.stop();
    workflowExportRunning = false;
    if (els.setupModal?.open && activeWorkflowStep === "player") renderWorkflowStep("player");
  }
}

async function continueWorkflow() {
  if (workflowPreparingExport || workflowExportRunning) return;
  if (activeWorkflowStep === "geometry") {
    if (!actualFieldMapGeometryReady()) {
      openActualFieldMapModal();
      actualMapSetStatus("Actual field map is required. Mark camera position, home plate, second base or rubber, and landing spot before continuing.", true);
      return;
    }
    markPredictionStale();
    updateEstimateBanner();
    persistDraft();
  }
  if (activeWorkflowStep === "landmarks" && !requiredVideoLandmarksReady()) {
    els.landmarkStatus.textContent = "Mark home plate, the pitching rubber, and two points along each baseline before continuing.";
    renderWorkflowStep("landmarks");
    return;
  }
  if (activeWorkflowStep === "ground") {
    applyWorkflowTerminalControls();
    setTerminalEvent();
    goToWorkflowStep("player");
    return;
  }
  if (activeWorkflowStep === "ballPath" && state.autoObservations.length && !state.detectionAccepted) {
    acceptAutoTrack();
  }
  if (activeWorkflowStep === "ballPath" && !ballDetectionSeedReadiness().ready) {
    els.autoTrackStatus.textContent = "Add ball points or run detection before continuing.";
    renderWorkflowStep("ballPath");
    return;
  }
  const index = workflowStepIndex();
  if (activeWorkflowStep === "player") {
    if (!selectedGameFrameTeamId() || !selectedGameFrameHitterId()) {
      openEvPeopleSelection();
      return;
    }
    workflowDetailsConfirmed = true;
    workflowError = "";
    workflowPreparingExport = true;
    renderWorkflowStep("player");
    els.setupContinue.disabled = true;
    els.setupContinue.classList.add("is-loading");
    els.setupContinue.textContent = "Saving hit...";
    const stopProgress = startWorkflowPredictionProgress(
      backgroundPredictionPromise ? "Finishing background prediction..." : "Calculating from your marks and camera setup...",
    );
    try {
      await nextPaint();
      if (backgroundPredictionPromise) {
        await backgroundPredictionPromise;
      } else if (!state.latestPrediction) {
        workflowPredictionAbortController = new AbortController();
        await runLivePrediction({ openModal: false, signal: workflowPredictionAbortController.signal });
      }
      stopProgress({ complete: true });
      renderWorkflowStep("player");
      if (needsLandingReview()) {
        if (!state.latestPrediction?.distance_review) openLandingReview();
        return;
      }
      if (predictionExportBlocker()) return;
      await runWorkflowExport();
    } catch (error) {
      stopProgress();
      if (isAbortError(error)) return;
      workflowError = `Could not create the video: ${error.message || error}`;
      els.predictionUnconstrained.textContent = String(error.message || error);
      setClipProgress(0, `Export failed: ${error.message || error}`);
      renderWorkflowStep("player");
    } finally {
      workflowPreparingExport = false;
      workflowPredictionAbortController = null;
      if (els.setupModal?.open) {
        renderWorkflowStep("player");
      }
      els.setupContinue.disabled = Boolean(predictionExportBlocker());
      els.setupContinue.classList.remove("is-loading");
      els.setupContinue.textContent = workflowCopy.player.action;
    }
    return;
  }
  if (index >= workflowSteps.length - 1) {
    closeSetupModal();
    return;
  }
  const nextStep = workflowSteps[index + 1];
  goToWorkflowStep(nextStep);
}

function backWorkflow() {
  cancelWorkflowPrediction();
  const index = workflowStepIndex();
  if (index <= 0) return;
  if (activeWorkflowStep === "player" && state.latestPrediction?.distance_review?.required) {
    goToWorkflowStep("ballPath");
    return;
  }
  if (activeWorkflowStep === "player" && !state.terminalEvent) {
    goToWorkflowStep("groundChoice");
    return;
  }
  if (workflowSteps[index - 1] === "geometry") {
    openSetupModal("geometry");
    return;
  }
  goToWorkflowStep(workflowSteps[index - 1]);
}

function openSetupModal(step = "geometry") {
  if (!els.setupModal?.showModal) return;
  document.body.classList.remove("page-video-hidden");
  if (step !== "export") {
    workflowExportRunning = false;
    workflowExportComplete = false;
  }
  if (step === "geometry") {
    activeWorkflowStep = "geometry";
    moveSetupControlsToSlot(els.setupControlsHome);
    document.body.classList.remove("setup-modal-open");
    if (els.setupModal.open) els.setupModal.close();
    openActualFieldMapModal();
    return;
  }
  renderWorkflowStep(step);
  document.body.classList.add("setup-modal-open");
  if (!els.setupModal.open) els.setupModal.showModal();
  if (step === "player") startBackgroundPrediction("player details opened");
}

function restoreAfterSetupModal({ hidePageVideo = document.body.classList.contains("page-video-hidden") } = {}) {
  document.body.classList.remove("setup-modal-open");
  els.setupModal.classList.remove("geometry-modal");
  setWorkflowVideoPrompt("");
  moveViewerToWorkflow(false);
  moveSetupControlsToSlot(els.setupControlsHome);
  setFieldToolExpanded(false);
  document.body.classList.toggle("page-video-hidden", hidePageVideo);
}

function closeSetupModal() {
  cancelWorkflowPrediction();
  restoreAfterSetupModal({ hidePageVideo: true });
  if (els.setupModal?.open) els.setupModal.close();
  updateEstimateBanner();
  persistDraft();
}

function hasActiveVideoSession() {
  return Boolean(
    state.videoFile
    || state.videoObjectUrl
    || state.fileName
    || state.contactTime !== null
    || state.observations.length
    || state.autoObservations.length
    || state.landmarks.length
    || state.terminalEvent
    || state.apexEvent
    || state.latestPrediction
  );
}

function confirmStartOverForVideoFile() {
  if (!hasActiveVideoSession()) return true;
  return window.confirm("Start over with a new video? This will clear the current marks, prediction, and unsaved setup.");
}

function skipCurrentVideoMark() {
  if (workflowPreparingExport || workflowExportRunning) return;
  let key;
  if (activeWorkflowStep === "contact") {
    if (!setContactFromDisplayedFrame()) return;
    key = "contact";
  } else if (activeWorkflowStep === "ballPath") {
    key = ballDetectionSeedReadiness().markKey;
  } else if (activeWorkflowStep === "landmarks") {
    key = `field:${els.landmarkType.value}`;
  }
  if (!key) return;
  if (key.startsWith("field:")) {
    state.landmarks = state.landmarks.filter(row => row.landmark !== key.slice(6));
    renderLandmarks();
  } else {
    const gap = Number(key.replace("flight", "")) * ballAnchorFrameGap()/10;
    const time = key === "contact" ? contactCalibrationTime() : adjacentFrameTime(gap,contactCalibrationTime());
    state.observations = state.observations.filter(row => Math.abs(Number(row.video_time_s)-time) > currentStep()*.9);
    state.autoObservations = [];
    renderObservations();
  }
  state.skippedVideoMarks = [...new Set([...(state.skippedVideoMarks || []), key])];
  markPredictionStale();
  persistDraft();
  if (activeWorkflowStep === "landmarks") {
    workflowLandmarkReview = false;
    if (requiredVideoLandmarksReady()) goToWorkflowStep("groundChoice");
    else renderWorkflowStep("landmarks");
  } else {
    goToWorkflowStep("ballPath");
  }
}

async function restartWorkflow() {
  const file = state.videoFile;
  if (!file || workflowPreparingExport || workflowExportRunning) return;
  cancelWorkflowPrediction();
  await window.GameFrameEvDrafts?.clear();
  loadVideoFile(file);
}

function resetHitSessionForNewVideo() {
  stopNativeBallAssist();state.ballAssistAccepted=false;
  state.skippedVideoMarks = [];
  state.gameframe.relatedCopyJobId = null;
  state.gameframe.pendingSwingId = null;
  state.gameframe.savedHitId = null;
  state.gameframe.swingSaveWarning = '';
  state.distanceCertainty = 'guess';
  state.savedDistanceUncertaintyFt = null;
  state.savedDistanceConfidence = null;
  cancelWorkflowPrediction();
  cancelBackgroundPrediction();
  closePredictionModal();
  if (els.actualFieldMapModal?.open) els.actualFieldMapModal.close();
  state.contactTime = null;
  state.contactFrameTime = null;
  state.frameTimes = [];
  state.videoTimingBusy = false;
  state.contactTimingMode = "ON_FRAME";
  state.contactTimingChoice = "ON_FRAME";
  state.observations = [];
  state.autoObservations = [];
  state.showAutoTrack = true;
  state.detectionAccepted = false;
  state.ballDetectionReadyAlerted = false;
  state.ballPathAudioStarted = false;
  state.landmarks = [];
  state.landmarkUndoStack = [];
  workflowLandmarkReview = false;
  state.pendingLandmarks = [];
  state.terminalEvent = null;
  state.apexEvent = null;
  state.latestPrediction = null;
  workflowDetailsConfirmed = false;
  workflowReviewRequested = false;
  workflowError = "";
  state.videoMetadata = {};
  state.cameraChangedDuringMarks = false;
  workflowExportRunning = false;
  workflowExportComplete = false;
  setWorkflowPredictionWorking(false);
  setClipProgress(0, "");
  if (els.hitDescription) els.hitDescription.value = "";
  if (els.autoTrackStatus) els.autoTrackStatus.textContent = "No detected path loaded.";
  if (els.showAutoTrack) els.showAutoTrack.checked = true;
  if (actualFieldMapState.map) actualMapResetPoints();
  renderObservations();
  renderLandmarks();
  renderTerminalEvent();
  renderApexEvent();
  renderEvidenceWarnings(null);
  updateEstimateBanner();
}

function loadVideoFile(file) {
  earlyEstimatePreparation?.cancel();
  earlyRegistrationPreparation?.cancel();
  document.querySelector(".ev-draft-resume")?.remove();
  resetHitSessionForNewVideo();
  if (state.videoObjectUrl) URL.revokeObjectURL(state.videoObjectUrl);
  state.videoFile = file;
  state.fileName = file.name;
  state.videoMetadata = {
    ...state.videoMetadata,
    file_name: file.name,
  };
  setFrameStepFromMetadata({});
  state.videoObjectUrl = URL.createObjectURL(file);
  els.video.src = state.videoObjectUrl;
  els.video.load();
  updateMenuAvailability();
  setMenuOpen(true);
  openSetupModal();
  if (window.GAMEFRAME_HOSTED) {
    state.hostedUpload = (async () => {
      const accountResponse = await fetch('/api/account');
      if (!accountResponse.ok) throw Error('Sign in before uploading footage.');
      const account = await accountResponse.json();
      const form = new FormData(); form.set('file', file);
      const response = await fetch('/api/source', {method:'POST', headers:{'X-CSRF-Token':account.csrf}, body:form});
      const source = await response.json();
      if (!response.ok) throw Error(source.error || 'Video upload failed.');
      if (state.videoFile === file) state.videoMetadata.source_path = source.source_path;
    })();
    state.hostedUpload.then(() => startSelectionPreparation(file)).catch(error => {
      els.autoTrackStatus.textContent = error.message;
    });
  } else { void startSelectionPreparation(file); }
  persistDraft();
}

window.addEventListener("message", (event) => {
  if (window.parent === window || event.source !== window.parent || !document.referrer) return;
  if (event.origin !== new URL(document.referrer).origin) return;
  if (event.data?.type !== "gameframe:load-ev-video" || !(event.data.file instanceof File)) return;
  if (!confirmStartOverForVideoFile()) return;
  showVideoWorkspace();
  loadVideoFile(event.data.file);
});

els.file.addEventListener("click", (event) => {
  filePickerStartOverApproved = false;
  if (!hasActiveVideoSession()) return;
  if (confirmStartOverForVideoFile()) {
    filePickerStartOverApproved = true;
    return;
  }
  event.preventDefault();
  els.file.value = "";
});

els.file.addEventListener("change", () => {
  const file = els.file.files?.[0];
  if (!file) return;
  const approved = filePickerStartOverApproved || confirmStartOverForVideoFile();
  filePickerStartOverApproved = false;
  if (!approved) {
    els.file.value = "";
    return;
  }
  document.getElementById("video-picker-modal")?.close();
  loadVideoFile(file);
});

document.getElementById("open-video-picker")?.addEventListener("click", () => {
  document.getElementById("video-picker-modal").showModal();
});

els.packageFile?.addEventListener("change", async () => {
  const file = els.packageFile.files?.[0];
  if (!file) return;
  try {
    const packageData = JSON.parse(await file.text());
    loadPackageIntoState(packageData);
    els.autoTrackStatus.textContent = `Reloaded ${file.name}: ${state.observations.length} ball points, ${state.landmarks.length} landmarks.`;
  } catch (error) {
    els.autoTrackStatus.textContent = `JSON reload failed: ${error.message || error}`;
  }
});

els.video.addEventListener("loadedmetadata", () => {
  els.viewerPanel.classList.add("has-video");
  if (els.video.videoWidth && els.video.videoHeight) {
    els.viewer.style.aspectRatio = `${els.video.videoWidth} / ${els.video.videoHeight}`;
    els.viewer.style.setProperty("--source-video-ratio", `${els.video.videoWidth} / ${els.video.videoHeight}`);
  }
  state.videoMetadata = {
    ...state.videoMetadata,
    file_name: state.fileName,
    width_px: els.video.videoWidth || state.videoMetadata.width_px || null,
    height_px: els.video.videoHeight || state.videoMetadata.height_px || null,
    duration_s: els.video.duration ? round(els.video.duration, 6) : state.videoMetadata.duration_s ?? null,
    timing_source: state.videoMetadata.timing_source || "browser_media_time",
    frame_step_assumption_s: currentStep(),
  };
  syncCanvasSize();
  renderMetrics();
  // Audio preparation chooses the useful timing window; avoid probing zero
  // first and making the user wait for a second probe around contact.
  if(selectionPreparation?.file!==state.videoFile)refreshVideoTiming();
  ensureWorkflowContactSuggestion();
  if (activeWorkflowStep === 'landmarks' && els.setupModal.open && state.contactTime !== null) {
    seekVideoTo(contactCalibrationTime());
  }
  persistDraft();
});

els.video.addEventListener("seeked", () => {
  const frames=state.frameTimes || [];
  if(!frames.length || els.video.currentTime < frames[0] || els.video.currentTime > frames.at(-1)-currentStep()) refreshVideoTiming();
});

els.video.addEventListener("timeupdate", () => {
  renderMetrics();
  renderOverlay();
});

els.video.addEventListener("pause", () => {
  els.playPause.textContent = "Play";
});

els.video.addEventListener("play", () => {
  els.playPause.textContent = "Pause";
});

els.playPause.addEventListener("click", () => {
  if (els.video.paused) els.video.play();
  else els.video.pause();
});

els.modeBall.addEventListener("click", () => setClickMode("ball"));
els.modeLandmark.addEventListener("click", () => setClickMode("landmark"));
els.modeTerminal.addEventListener("click", () => setClickMode("terminal"));
els.modeEraser.addEventListener("click", () => setClickMode("eraser"));
els.clickMode.addEventListener("change", () => setClickMode(els.clickMode.value));

els.timeline.addEventListener("input", () => {
  if (!els.video.duration) return;
  els.video.pause();
  els.video.currentTime = Number(els.timeline.value);
  syncTimeline();
  renderMetrics();
  renderOverlay();
  if (els.setupModal?.open && activeWorkflowStep === "geometry") {
    requestAnimationFrame(renderGeometryVideoPreview);
  }
});

els.backFrame.addEventListener("click", () => {
  seekVideoByFrames(-1);
});

els.forwardFrame.addEventListener("click", () => {
  seekVideoByFrames(1);
});

els.setContact.addEventListener("click", () => {
  if (!setContactFromDisplayedFrame()) return;
});

els.detectContactAudio.addEventListener("click", detectContactFromAudio);

els.clearContact.addEventListener("click", () => {
  state.contactTime = null;
  for (const obs of state.observations) obs.relative_time_s = null;
  state.apexEvent = null;
  renderMetrics();
  renderObservations();
  renderApexEvent();
  persistDraft();
});

els.setApexFrame.addEventListener("click", () => {
  const rel = relativeTime();
  if (rel === null) {
    els.autoTrackStatus.textContent = "Set contact before marking apex.";
    return;
  }
  state.apexEvent = {
    video_time_s: round(els.video.currentTime || 0, 6),
    relative_time_s: round(rel, 6),
    timing_uncertainty_s: currentStep(),
    confidence: "HIGH",
    source: "HUMAN",
  };
  renderApexEvent();
  persistDraft();
});

els.clearApexFrame.addEventListener("click", () => {
  state.apexEvent = null;
  renderApexEvent();
  persistDraft();
});

els.setGroundFrame.addEventListener("click", () => {
  if (!els.video.videoWidth) {
    els.autoTrackStatus.textContent = "Load a video before setting ground contact.";
    return;
  }
  setTerminalEvent();
});

els.clearGroundContact.addEventListener("click", () => {
  state.terminalEvent = null;
  renderTerminalEvent();
  renderOverlay();
  persistDraft();
});

let fieldMarkerDrag = null, suppressFieldMarkerClick = false;
els.overlay.addEventListener('pointerdown', event => {
  if (activeWorkflowStep !== 'landmarks' || !els.setupModal.open || els.video.seeking) return;
  const point = displayToVideoPoint(event);
  const rows = [...state.pendingLandmarks, ...state.landmarks];
  const row = rows.reduce((best, row) => {
    const p = videoToDisplayPoint(row.image_x, row.image_y);
    const distance = Math.hypot(p.x - (event.clientX - els.overlay.getBoundingClientRect().left),
      p.y - (event.clientY - els.overlay.getBoundingClientRect().top));
    return distance < (best?.distance ?? 24) ? {row,distance} : best;
  }, null)?.row;
  if (!row) return;
  event.preventDefault();event.stopImmediatePropagation();
  fieldMarkerDrag = {row,id:event.pointerId};
  suppressFieldMarkerClick = true;
  els.landmarkType.value = row.landmark;
  els.overlay.setPointerCapture(event.pointerId);
}, true);
els.overlay.addEventListener('pointermove', event => {
  if (!fieldMarkerDrag || fieldMarkerDrag.id !== event.pointerId) return;
  event.preventDefault();event.stopImmediatePropagation();
  const point = displayToVideoPoint(event), row = fieldMarkerDrag.row;
  row.image_x = round(Math.max(0,Math.min(els.video.videoWidth,point.x)),2);
  row.image_y = round(Math.max(0,Math.min(els.video.videoHeight,point.y)),2);
  row.human_reviewed = true;
  renderOverlay();
}, true);
function finishFieldMarkerDrag(event) {
  if (!fieldMarkerDrag || fieldMarkerDrag.id !== event.pointerId) return;
  event.preventDefault();event.stopImmediatePropagation();
  fieldMarkerDrag = null;
  setTimeout(() => { suppressFieldMarkerClick = false; }, 0);
  if (els.overlay.hasPointerCapture(event.pointerId)) els.overlay.releasePointerCapture(event.pointerId);
  markPredictionStale();renderLandmarks();persistDraft();
}
els.overlay.addEventListener('pointerup',finishFieldMarkerDrag,true);
els.overlay.addEventListener('pointercancel',finishFieldMarkerDrag,true);
els.overlay.addEventListener('click', event => {
  if (!suppressFieldMarkerClick) return;
  suppressFieldMarkerClick = false;event.preventDefault();event.stopImmediatePropagation();
}, true);

els.overlay.addEventListener("click", async (event) => {
  if (!wizardEditingActive()) return;
  if(activeWorkflowStep==='contact'&&contactSuggestionBusy)return;
  if (activeWorkflowStep === 'ballPath' && ['running','review'].includes(nativeBallAssist.phase)) return;
  if (!els.video.videoWidth) return;
  const point = displayToVideoPoint(event);
  if (els.clickMode.value === "eraser") {
    if (!eraseNearestMarker(point)) {
      els.autoTrackStatus.textContent = "Nothing close enough to erase.";
    }
  } else if (els.clickMode.value === "landmark") {
    if (addLandmark({ x: point.x, y: point.y }) === false) return;
    if (els.setupModal?.open && activeWorkflowStep === "landmarks") {
      if (requiredVideoLandmarksReady() && !workflowLandmarkReview) goToWorkflowStep("groundChoice");
      else renderWorkflowStep("landmarks");
    }
  } else if (els.clickMode.value === "terminal") {
    setTerminalEvent({ x: point.x, y: point.y });
    if (els.setupModal?.open && activeWorkflowStep === "ground") renderWorkflowStep("ground");
  } else {
    if (activeWorkflowStep === "contact") {
      if (els.video.seeking) return;
      const changed = state.contactTime !== null && Math.abs(els.video.currentTime - contactCalibrationTime()) > currentStep() * .55;
      if (changed) {
        state.observations = state.observations.filter(row => row.role !== "CONTACT_POINT" && row.relative_time_s !== 0);
        state.landmarks = [];
        state.landmarkUndoStack = [];
        state.autoObservations = [];
        workflowLandmarkReview = false;
      }
      if (!setContactFromDisplayedFrame()) return;
      if (state.terminalEvent) state.terminalEvent.relative_time_s = round(relativeTime(state.terminalEvent.video_time_s), 6);
      const contact = addObservation({x: point.x, y: point.y, note: "Contact ball point."});
      contact.role = "CONTACT_POINT";
      contact.source = 'HUMAN';
      contact.contact_timing_mode = state.contactTimingMode;
      persistDraft();
      scheduleContactPreload();
      await beginNativeBallAssist();
      return;
    }
    addObservation({
      x: point.x,
      y: point.y,
      note: els.pointNote.value.trim(),
    });
    if (els.setupModal?.open && activeWorkflowStep === "ballPath") renderWorkflowStep("ballPath");
  }
});

els.undoObservation.addEventListener("click", () => {
  if (els.clickMode.value === "landmark") {
    state.landmarks.pop();
    reindexRows(state.landmarks);
    renderLandmarks();
    renderOverlay();
    persistDraft();
  } else if (els.clickMode.value === "terminal") {
    state.terminalEvent = null;
    renderTerminalEvent();
    renderOverlay();
    persistDraft();
  } else {
    undoLastObservation();
  }
});

els.showAutoTrack.addEventListener("change", () => {
  state.showAutoTrack = els.showAutoTrack.checked;
  renderOverlay();
  persistDraft();
});

els.suggestLandmarks?.addEventListener("click", suggestFieldLandmarks);
els.acceptLandmarkSuggestions?.addEventListener("click", acceptLandmarkSuggestions);
els.rejectLandmarkSuggestions?.addEventListener("click", rejectLandmarkSuggestions);

els.acceptAutoTrack.addEventListener("click", acceptAutoTrack);

els.clearAutoTrack.addEventListener("click", clearAutoTrack);

els.showFlightView.addEventListener("click", showFlightView);
els.resetFlightView.addEventListener("click", resetFlightView);
els.flightVideoView?.addEventListener("click", () => setFlightPreset("video"));
els.flightTopView?.addEventListener("click", () => setFlightPreset("top"));
els.flightSideView?.addEventListener("click", () => setFlightPreset("side"));
els.flightBehindView?.addEventListener("click", () => setFlightPreset("behind"));
els.flightPlay?.addEventListener("click", () => setFlightPlaying(!state.flightView.playing));
function applyFlightTimeFromSlider() {
  state.flightView.time = Math.max(0, Math.min(1, Number(els.flightTime.value) || 0));
  setFlightPlaying(false);
  renderFlightView();
}
els.flightTime?.addEventListener("input", applyFlightTimeFromSlider);
els.flightTime?.addEventListener("change", applyFlightTimeFromSlider);
els.flightViewer.addEventListener("pointerdown", (event) => {
  if (!state.flightView.visible) return;
  if (event.target.closest?.(".flight-controls")) return;
  event.preventDefault();
  state.flightView.dragging = true;
  state.flightView.dragStartX = event.clientX;
  state.flightView.dragStartY = event.clientY;
  state.flightView.dragOriginYaw = state.flightView.yaw;
  state.flightView.dragOriginPitch = state.flightView.pitch;
  state.flightView.dragOriginRoll = state.flightView.roll;
  state.flightView.dragButton = event.button;
  els.flightViewer.setPointerCapture(event.pointerId);
});
els.flightViewer.addEventListener("pointermove", (event) => {
  if (!state.flightView.dragging) return;
  const dx = event.clientX - state.flightView.dragStartX;
  const dy = event.clientY - state.flightView.dragStartY;
  if (event.shiftKey || state.flightView.dragButton === 2) {
    state.flightView.roll = state.flightView.dragOriginRoll + dx * 0.012;
  } else {
    state.flightView.yaw = state.flightView.dragOriginYaw + dx * 0.01;
    state.flightView.pitch = Math.max(0.08, Math.min(1.565, state.flightView.dragOriginPitch - dy * 0.006));
  }
  renderFlightView();
});
els.flightViewer.addEventListener("pointerup", (event) => {
  state.flightView.dragging = false;
  if (els.flightViewer.hasPointerCapture(event.pointerId)) {
    els.flightViewer.releasePointerCapture(event.pointerId);
  }
});
els.flightViewer.addEventListener("wheel", (event) => {
  if (!state.flightView.visible) return;
  event.preventDefault();
  const zoomFactor = event.deltaY < 0 ? 1.08 : 0.92;
  state.flightView.zoom = Math.max(0.55, Math.min(2.8, state.flightView.zoom * zoomFactor));
  renderFlightView();
}, { passive: false });
els.flightViewer.addEventListener("contextmenu", (event) => event.preventDefault());

els.openActualFieldMap?.addEventListener("click", openActualFieldMapModal);
document.getElementById('camera-height-toggle').addEventListener('click',event=>{
  const panel=document.getElementById('camera-height-panel');
  panel.hidden=!panel.hidden;
  event.currentTarget.setAttribute('aria-expanded',String(!panel.hidden));
  refreshActualFieldMap();
});
els.actualFieldSearchButton?.addEventListener("click", searchActualFieldAddress);
els.actualFieldSearch?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") searchActualFieldAddress();
});
els.actualFieldSavedLocation?.addEventListener("change", useSavedActualFieldLocation);
document.querySelectorAll('input[name="landing-certainty"]').forEach(input => {
  input.addEventListener('change', () => {
    state.distanceCertainty = input.value;
    markPredictionStale();
    els.actualMapContinue.disabled = !actualMapReadyForConfirm();
  });
});
els.actualFieldSearch?.addEventListener("input", () => {
  if (actualMapStage === "address") els.actualMapContinue.disabled = !els.actualFieldSearch.value.trim();
});
els.actualMapReset?.addEventListener("click", () => {
  actualMapResetPoints();
  setActualMapStage("points");
});
els.actualMapBackDiagram?.addEventListener("click", () => {
  if (actualMapStage === 'compare') closeActualFieldMapModal();
  else if (actualMapStage === 'review') cancelLandingReview();
  else if (actualMapStage === "address") closeActualFieldMapModal();
  else setActualMapStage("address");
});
els.actualMapContinue?.addEventListener("click", () => {
  if (actualMapStage === 'review') {
    if (landingReviewSaving) return;
    landingReviewSaving = true;
    els.actualMapContinue.disabled = true;
    els.actualMapBackDiagram.disabled = true;
    document.getElementById('actual-map-keep-original').disabled = true;
    applyActualFieldMapValues().then(async (applied) => {
      if (!applied) return;
      workflowError = '';
      goToWorkflowStep('player');
      await startBackgroundPrediction('map marks updated');
    }).catch(error => {
      workflowError = error.message || 'Could not update map marks.';
      if (els.actualFieldMapModal.open) actualMapSetStatus(workflowError, true);
      else goToWorkflowStep('player');
    }).finally(() => {
      landingReviewSaving = false;
      els.actualMapContinue.disabled = false;
      els.actualMapBackDiagram.disabled = false;
      document.getElementById('actual-map-keep-original').disabled = false;
    });
    return;
  }
  if (actualMapStage === "address") {
    const selected = readSavedActualFieldLocations()[Number(els.actualFieldSavedLocation.value)];
    if (els.actualFieldSavedLocation.value && selected && els.actualFieldSearch.value.trim() === (selected.query || selected.label || "")) {
      setActualMapStage(actualMapReadyForConfirm() ? "confirm" : "points");
    } else searchActualFieldAddress();
    return;
  }
  applyActualFieldMapValues({ continueAfter: true }).catch((error) => {
    console.error("Actual field map setup failed", error);
    actualMapSetStatus(error.message || "Map setup failed.", true);
  });
});
els.actualFieldMapModal?.addEventListener("cancel", (event) => {
  event.preventDefault();
  // Keep marks and the current task in place; use an explicit button to leave.
});
document.getElementById('actual-map-video-panel').addEventListener('toggle', () => {
  const panel = document.getElementById('actual-map-video-panel');
  els.actualFieldMapModal.classList.toggle('map-video-open', panel.open);
  if (!panel.open) document.getElementById('actual-map-video').pause();
  refreshActualFieldMap();
});
document.getElementById('actual-map-keep-original').addEventListener('click', () => {
  if (landingReviewSaving) return;
  cancelLandingReview();
  landingReviewAcknowledged = state.latestPrediction;
  renderWorkflowStep('player');
});

[
  els.contactConfidence,
  els.contactAudioLeadFrames,
  els.clickMode,
  els.landmarkType,
  els.pointSource,
  els.pointConfidence,
  els.uncertainty,
  els.pointNote,
  els.terminalType,
  els.terminalUncertaintyFrames,
  els.hitDescription,
  els.cameraVantage,
  els.direction,
  els.fieldSize,
  els.cameraHeightFt,
  els.distanceFt,
  els.distanceUncertaintyFt,
].filter(Boolean).forEach((element) => {
  element.addEventListener("change", () => {
    if ([
      els.cameraVantage,
      els.direction,
      els.fieldSize,
      els.cameraHeightFt,
      els.distanceFt,
      els.distanceUncertaintyFt,
      els.terminalType,
      els.terminalUncertaintyFrames,
    ].includes(element)) {
      markPredictionStale();
    }
    if (element === els.fieldSize) {
      updateFieldDiagram();
      actualMapUpdateMeasurements();
      renderFlightView();
    }
    updateEstimateBanner();
    persistDraft();
  });
});

[
  els.cameraHeightFt,
  els.distanceFt,
  els.distanceUncertaintyFt,
].filter(Boolean).forEach((element) => {
  element?.addEventListener("input", () => {
    markPredictionStale();
    updateEstimateBanner();
    persistDraft();
  });
});

els.hitDescription.addEventListener("input", () => {
  updateEstimateBanner();
  persistDraft();
});

els.gameframeTeam?.addEventListener("change", () => {
  renderGameFrameOptions({ preferredTeamId: selectedGameFrameTeamId() });
  rememberGameFramePeople();
  setGameFrameStatus("not saved");
});
els.gameframeHitter?.addEventListener("change", () => {
  syncTeamFromSelectedHitter();
  rememberGameFramePeople();
  setGameFrameStatus("not saved");
  if (document.getElementById('ev-people-modal').open && selectedGameFrameHitterId()) {
    void continueEvPeopleSelection();
  }
});
els.addTeam?.addEventListener("click", async () => {
  try {
    await addGameFrameTeam();
  } catch (error) {
    setGameFrameStatus("team add failed");
    alert(error.message || error);
  }
});
els.addHitter?.addEventListener("click", async () => {
  try {
    await addGameFrameHitter();
  } catch (error) {
    setGameFrameStatus("hitter add failed");
    alert(error.message || error);
  }
});
els.downloadJson.addEventListener("click", () => {
  const packageName = state.terminalEvent
    ? "observation-package-with-ground-contact.json"
    : "observation-package-missing-ground-contact.json";
  persistDraft("saved");
  download(
    packageName,
    "application/json",
    JSON.stringify(buildPackage(), null, 2),
  );
});

els.downloadCsv?.addEventListener("click", () => {
  download("ball-observations.csv", "text/csv", observationsToCsv());
});

els.downloadClip?.addEventListener("click", downloadClippedVideo);
els.loadPrediction?.addEventListener("click", loadPrediction);
els.openSimulation?.addEventListener("click", openSimulation);
els.toggleDataRecords?.addEventListener("click", toggleDataRecords);
els.openWorkflow?.addEventListener("click", () => openSetupModal("geometry"));
let stopEvVideoWatch=null;
function showEvCompletion() {
  const id=state.gameframe.savedHitId;if(!id){openSharedLibrary();return;}
  const modal=document.getElementById('ev-complete-modal'),video=document.getElementById('ev-complete-video');
  const downloadButton=document.getElementById('ev-complete-download'),metrics=document.getElementById('ev-complete-metrics');
  const generated=`/stream/ev-clip?id=${encodeURIComponent(id)}&kind=generated&inline=1`;
  const source=`/stream/ev-clip?id=${encodeURIComponent(id)}&kind=source&inline=1`;
  let pendingVideo=null;
  const loadReady=()=>{if(pendingVideo){video.src=pendingVideo;pendingVideo=null;metrics.hidden=true;}};
  video.onended=loadReady;video.onpause=loadReady;
  const apply=status=>{
    if(state.gameframe.savedHitId!==id)return;
    state.gameframe.videoRenderStatus=status.status;state.gameframe.videoRenderError=status.error||null;
    if(status.pending_swing_id)state.gameframe.pendingSwingId=Number(status.pending_swing_id);
    const ready=status.status==='ready',failed=status.status==='error';
    downloadButton.disabled=!ready&&!failed;downloadButton.textContent=failed?'Retry video':ready?'Download video':'Preparing video...';
    downloadButton.onclick=failed?async()=>{
      downloadButton.disabled=true;
      try{const result=await window.GameFrameEvVideo.retry(id);apply(result);startWatch();}
      catch(error){state.gameframe.swingSaveWarning='Hit saved. '+error.message;updateEvCompletionCopyStatus();downloadButton.disabled=false;}
    }:()=>{if(ready)window.location.href=`/stream/ev-clip?id=${encodeURIComponent(id)}&kind=generated`;};
    if(ready&&video.getAttribute('src')!==generated){pendingVideo=generated;if(video.paused||video.ended)loadReady();}
    updateEvCompletionCopyStatus();
  };
  const startWatch=()=>{stopEvVideoWatch?.();stopEvVideoWatch=window.GameFrameEvVideo.watch({id,onStatus:apply,onError:error=>{
    if(state.gameframe.savedHitId===id){document.getElementById('ev-complete-notice').textContent=error.status===404?'This saved hit was removed.':'Hit saved. Checking video preparation again shortly...';}
  }});};
  const ready=(state.gameframe.videoRenderStatus||'ready')==='ready';
  metrics.textContent=clipBannerLines().filter(line=>/^(EV |LA |Distance )/i.test(line)).join(' | ');
  metrics.hidden=ready;
  video.src=ready?generated:source;
  video.onerror=()=>{
    const kind=(video.getAttribute('src')||'').includes('kind=generated')?'generated':'source';
    const fallback=`/api/gameframe/ev-clip?id=${encodeURIComponent(id)}&kind=${kind}&inline=1`;
    if(video.getAttribute('src')!==fallback){video.src=fallback;return;}
    document.getElementById('ev-complete-notice').textContent='Hit saved. Open Library to view the saved clip and video status.';
  };
  const close=()=>{video.pause();stopEvVideoWatch?.();modal.close();};
  modal.onclose=()=>{
    stopEvVideoWatch?.();stopEvVideoWatch=null;
    video.onpause=null;video.onended=null;video.pause();
    video.removeAttribute?.('src');video.load?.();
  };
  document.getElementById('ev-complete-timing').onclick=()=>{close();openSavedSwingTiming(state.gameframe.pendingSwingId);};
  document.getElementById('ev-complete-library').onclick=()=>{close();openSharedLibrary();};
  apply({status:state.gameframe.videoRenderStatus||'ready'});
  if(!modal.open)modal.showModal();
  if(!ready)startWatch();
}

function openSavedSwingTiming(id) {
  if (window.parent !== window && document.referrer) {
    window.parent.postMessage({ type: "gameframe:tag-swing", id }, new URL(document.referrer).origin);
  } else {
    const destination = new URL(window.location.href);
    destination.pathname = "/multi-swing/pending/tag";
    destination.search = `?id=${encodeURIComponent(id)}&sid=x`;
    destination.hash = "";
    window.location.href = destination.href;
  }
}

function openSharedLibrary() {
  if (window.parent !== window && document.referrer) {
    window.parent.postMessage({ type: "gameframe:open-library" }, new URL(document.referrer).origin);
  } else {
    const library = new URL(window.location.href);
    library.pathname = "/library";
    library.search = "?type=ev&sid=x";
    library.hash = "";
    window.location.href = library.href;
  }
}

els.openEvLibrary?.addEventListener("click", (event) => {
  event.preventDefault();
  openSharedLibrary();
});
els.closeEvLibrary?.addEventListener("click", showVideoWorkspace);
els.evLibraryList?.addEventListener("click", async (event) => {
  const checkbox = event.target.closest?.("[data-library-select]");
  if (checkbox) {
    const hitId = String(checkbox.dataset.librarySelect || "");
    if (checkbox.checked) state.gameframe.selectedEvHitIds.add(hitId);
    else state.gameframe.selectedEvHitIds.delete(hitId);
    updateEvLibrarySelectionControls();
    return;
  }
  const button = event.target.closest?.("[data-library-action]");
  if (!button) return;
  const action = button.dataset.libraryAction;
  const hitId = button.dataset.hitId;
  if (!hitId) return;
  try {
    button.disabled = true;
    if (action === "description") {
      await updateSavedEvDescription(hitId);
    } else if (action === "overview") {
      await openHitOverviewModal(hitId);
    } else if (action === "map") {
      showVideoWorkspace();
      await loadSavedEvHitFromDatabase(hitId);
      openMapComparison();
    } else if (action === "setup") {
      showVideoWorkspace();
      await loadSavedEvHitFromDatabase(hitId);
      openSetupModal("geometry");
    } else if (action === "delete") {
      await deleteSavedEvHit(hitId);
    }
  } catch (error) {
    if (els.evLibraryStatus) els.evLibraryStatus.textContent = error.message || String(error);
  } finally {
    button.disabled = false;
  }
});
els.evLibrarySearch?.addEventListener("input", renderEvLibrary);
els.evLibrarySelectVisible?.addEventListener("click", () => {
  visibleEvLibraryHits().forEach((hit) => state.gameframe.selectedEvHitIds.add(String(hit.id)));
  renderEvLibrary();
});
els.evLibraryClearSelection?.addEventListener("click", () => {
  state.gameframe.selectedEvHitIds.clear();
  renderEvLibrary();
});
els.evLibraryDeleteSelected?.addEventListener("click", async () => {
  try {
    await deleteSelectedEvHits();
  } catch (error) {
    if (els.evLibraryStatus) els.evLibraryStatus.textContent = error.message || String(error);
    updateEvLibrarySelectionControls();
  }
});
els.closeLibraryOverview?.addEventListener("click", () => {
  if (els.libraryOverviewModal?.open) els.libraryOverviewModal.close();
});
els.copyLibraryOverview?.addEventListener("click", async () => {
  const text = els.libraryOverviewText?.value || "";
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    if (els.libraryOverviewStatus) els.libraryOverviewStatus.textContent = "Overview copied to clipboard.";
  } catch {
    els.libraryOverviewText?.focus();
    els.libraryOverviewText?.select();
    if (els.libraryOverviewStatus) els.libraryOverviewStatus.textContent = "Text selected. Use Ctrl+C to copy.";
  }
});
els.setupBack.addEventListener("click", backWorkflow);
els.setupCancel?.addEventListener("click", closeSetupModal);
els.setupSecondary?.addEventListener("click", () => {
  if (!["ground", "groundChoice"].includes(activeWorkflowStep)) return;
  state.terminalEvent = null;
  markPredictionStale();
  renderTerminalEvent();
  renderOverlay();
  persistDraft();
  goToWorkflowStep("player");
});
els.setupContinue.addEventListener("click", continueWorkflow);
els.setupModal.addEventListener("cancel", (event) => {
  event.preventDefault();
});
els.setupModal.addEventListener("close", restoreAfterSetupModal);
els.closePrediction.addEventListener("click", closePredictionModal);
els.predictionModal.addEventListener("click", (event) => {
  if (event.target === els.predictionModal) event.preventDefault();
});
els.expandFieldTool.addEventListener("click", toggleFieldToolExpanded);
els.closeFieldTool.addEventListener("click", () => setFieldToolExpanded(false));
els.closeFieldTool.hidden = true;

els.menuScrim?.addEventListener("click", () => setMenuOpen(false));

document.querySelectorAll(".side-panel > details.panel-block").forEach((details) => {
  details.addEventListener("toggle", () => {
    if (!details.open) return;
    document.querySelectorAll(".side-panel > details.panel-block").forEach((other) => {
      if (other !== details) other.open = false;
    });
  });
});

installMarkerDrag(els.cameraMarker, "camera");
installMarkerDrag(els.landingMarker, "landing");
updateFieldDiagram();
setMarkerPosition("camera", markers.camera.x, markers.camera.y);
setMarkerPosition("landing", markers.landing.x, markers.landing.y);
loadGameFrameOptions().then(offerEvDraftResume);
// Loading every saved hit is unnecessary when starting a new measurement.
if (window.location.hash === "#library") showEvLibrary();
updateMenuAvailability();
updateEstimateBanner();

async function applyBallAssistHandoff() {
  const token = new URLSearchParams(location.search).get('ball_assist');
  if (!token) return;
  const key = 'gameframe.ball-assist.' + token;
  const payload = JSON.parse(sessionStorage.getItem(key) || 'null');
  if (!payload) throw Error('The auto-marking review has expired. Return to the test and try again.');
  const source = new URL(payload.videoUrl, location.href);
  if (source.origin !== location.origin || !/^\/test\/ball-assist\/api\/session\/[0-9a-f-]{36}\/video$/i.test(source.pathname)) throw Error('Invalid test video.');
  const response = await fetch(source.href);
  if (!response.ok) throw Error('The test video is no longer available.');
  const blob = await response.blob();
  state.videoFile = new File([blob], payload.session.name, {type:blob.type || 'video/mp4'});
  if (state.videoObjectUrl) URL.revokeObjectURL(state.videoObjectUrl);
  state.videoObjectUrl = URL.createObjectURL(blob);
  await new Promise((resolve,reject) => {
    const timer=setTimeout(()=>finish(Error('The test video could not be loaded.')),30000);
    const finish=error=>{clearTimeout(timer);els.video.removeEventListener('loadedmetadata',loaded);els.video.removeEventListener('error',failed);error?reject(error):resolve();};
    const loaded=()=>finish(),failed=()=>finish(Error('The test video could not be loaded.'));
    els.video.addEventListener('loadedmetadata',loaded,{once:true});els.video.addEventListener('error',failed,{once:true});els.video.src=state.videoObjectUrl;els.video.load();
  });
  const prepared=GameFrameBallAssist.prepare(payload,els.video.videoWidth,els.video.videoHeight);
  cancelBackgroundPrediction();
  const oldWidth=Number(state.videoMetadata?.width_px)||els.video.videoWidth,oldHeight=Number(state.videoMetadata?.height_px)||els.video.videoHeight;
  state.landmarks=state.landmarks.map(p=>({...p,image_x:p.image_x*els.video.videoWidth/oldWidth,image_y:p.image_y*els.video.videoHeight/oldHeight,calibration_time_s:p.calibration_time_s==null?prepared.contactTime:Math.max(0,p.calibration_time_s-Number(payload.sourceTimeOffset||0))}));
  state.fileName=payload.session.name;
  state.videoMetadata={...state.videoMetadata,file_name:state.fileName,width_px:els.video.videoWidth,height_px:els.video.videoHeight,duration_s:els.video.duration,frame_times_s:payload.session.times,frame_step_assumption_s:1/payload.session.fps};
  delete state.videoMetadata.source_path;
  state.frameTimes=payload.session.times;
  setFrameStepFromMetadata(state.videoMetadata);
  setContactTime(prepared.contactTime);
  state.observations=prepared.observations;reindexRows(state.observations);
  state.autoObservations=[];state.skippedVideoMarks=[];state.terminalEvent=null;state.apexEvent=null;
  state.latestPrediction=null;state.flightView.visible=false;state.gameframe.savedHitId=null;
  state.detectionAccepted=prepared.accepted;state.ballAssistAccepted=prepared.accepted;
  renderObservations();renderLandmarks();renderTerminalEvent();renderApexEvent();renderMetrics();renderOverlay();updateEstimateBanner();
  persistDraft('auto-marking review');
  goToWorkflowStep(prepared.accepted?'landmarks':'ballPath');
  sessionStorage.removeItem(key);
}

const savedEvHitId = new URLSearchParams(window.location.search).get("ev_hit_id");
if (savedEvHitId) {
  loadSavedEvHitFromDatabase(savedEvHitId)
    .then(async () => { if (new URLSearchParams(window.location.search).has('ball_assist')) await applyBallAssistHandoff(); else if (new URLSearchParams(window.location.search).get('view') === 'map') openMapComparison(); })
    .catch((error) => {
      els.autoTrackStatus.textContent = `Saved EV hit load failed: ${error.message || error}`;
    });
}
else if (new URLSearchParams(location.search).has('ball_assist')) {
  applyBallAssistHandoff().catch(error=>{els.autoTrackStatus.textContent=`Could not continue from auto-marking: ${error.message}`;});
}

function handleFrameShortcut(event) {
  if (document.getElementById('watch-source-modal')?.open) return;
  if (event.key === "Escape") {
    setMenuOpen(false);
    return;
  }
  if (isTypingTarget(event.target)) return;
  if (els.actualFieldMapModal?.open) return;
  if (els.setupModal?.open && !workflowFrameNavigationAllowed()) return;
  if (event.key === "ArrowLeft" || event.key === "[" || event.key === "," || event.key.toLowerCase() === "p") {
    event.preventDefault();
    event.stopPropagation();
    seekVideoByFrames(event.shiftKey ? -5 : -1);
  } else if (event.key === "ArrowRight" || event.key === "]" || event.key === "." || event.key.toLowerCase() === "n") {
    event.preventDefault();
    event.stopPropagation();
    seekVideoByFrames(event.shiftKey ? 5 : 1);
  } else if (event.key === " ") {
    event.preventDefault();
    event.stopPropagation();
    if (els.video.paused) els.video.play();
    else els.video.pause();
  } else if (event.key === "Home") {
    event.preventDefault();
    event.stopPropagation();
    seekVideoTo(0);
  } else if (event.key === "End") {
    event.preventDefault();
    event.stopPropagation();
    seekVideoTo(els.video.duration || 0);
  }
}

window.addEventListener("keydown", handleFrameShortcut, true);

// Use an independent player so reviewing footage never seeks the marking video.
const watchSourceModal = document.getElementById('watch-source-modal');
const watchSourceVideo = document.getElementById('watch-source-video');
const watchSourceStatus = document.getElementById('watch-source-status');
if (watchSourceModal) {
  const buttons = [];
  for (const selector of ['#setup-modal .setup-heading', '#actual-field-map-modal .setup-heading',
    '#prediction-modal .modal-actions', '.viewer-panel .transport']) {
    const host = document.querySelector(selector);
    if (!host) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'watch-source-button';
    button.textContent = 'Watch video';
    button.disabled = !els.video.readyState;
    button.addEventListener('click', () => {
      const source = els.video.currentSrc || els.video.src;
      if (!source) return;
      const position = els.video.currentTime;
      els.video.pause();
      document.getElementById('actual-map-video')?.pause();
      document.getElementById('ev-complete-video')?.pause();
      watchSourceStatus.textContent = 'Review the original video. Your marks and current step stay in place.';
      watchSourceVideo.onloadedmetadata = () => { watchSourceVideo.currentTime = position; };
      watchSourceVideo.src = source;
      watchSourceModal.showModal();
      watchSourceVideo.play().catch(() => {
        watchSourceStatus.textContent = 'Press Play to watch. Your marks and current step stay in place.';
      });
    });
    host.appendChild(button);
    buttons.push(button);
  }
  els.video.addEventListener('loadedmetadata', () => buttons.forEach(button => { button.disabled = false; }));
  els.video.addEventListener('emptied', () => buttons.forEach(button => { button.disabled = true; }));
  document.getElementById('watch-source-close').addEventListener('click', () => watchSourceModal.close());
  watchSourceModal.addEventListener('close', () => {
    watchSourceVideo.pause();
    watchSourceVideo.onloadedmetadata = null;
    watchSourceVideo.removeAttribute('src');
    watchSourceVideo.load();
  });
}

// Viewing zoom affects only presentation. Tags remain in source-video pixels.
document.getElementById("ground-view-zoom").addEventListener("input", event => {
  groundView.zoom = Number(event.target.value);
  updateGroundView();
});
document.getElementById("ground-view-reset").addEventListener("click", () => {
  Object.assign(groundView, {zoom: 1, x: 0, y: 0});
  updateGroundView();
});
let groundPan = null, groundPanDragged = false;
els.overlay.addEventListener("pointerdown", event => {
  groundPanDragged = false;
  if (activeWorkflowStep !== "ground" || !els.setupModal.open || groundView.zoom <= 1 || event.button !== 0) return;
  els.video.pause();
  groundPan = {id: event.pointerId, startX: event.clientX, startY: event.clientY, x: groundView.x, y: groundView.y};
  els.overlay.setPointerCapture(event.pointerId);
}, true);
els.overlay.addEventListener("pointermove", event => {
  if (!groundPan || event.pointerId !== groundPan.id) return;
  const dx = event.clientX - groundPan.startX, dy = event.clientY - groundPan.startY;
  if (Math.hypot(dx, dy) > 5) groundPanDragged = true;
  if (!groundPanDragged) return;
  event.preventDefault();
  groundView.x = groundPan.x + dx;
  groundView.y = groundPan.y + dy;
  updateGroundView();
}, true);
function endGroundPan(event) {
  if (!groundPan || groundPan.id !== event.pointerId) return;
  if (els.overlay.hasPointerCapture(event.pointerId)) els.overlay.releasePointerCapture(event.pointerId);
  groundPan = null;
}
els.overlay.addEventListener("pointerup", endGroundPan, true);
els.overlay.addEventListener("pointercancel", endGroundPan, true);
els.overlay.addEventListener("click", event => {
  if (!groundPanDragged) return;
  groundPanDragged = false;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
els.overlay.addEventListener("wheel", event => {
  if (activeWorkflowStep !== "ground" || !els.setupModal.open) return;
  event.preventDefault();
  groundView.zoom = Math.max(1, Math.min(6, groundView.zoom + (event.deltaY < 0 ? .25 : -.25)));
  updateGroundView();
}, {passive: false});
els.setupModal.addEventListener("close", () => {
  if (['running','review'].includes(nativeBallAssist.phase)) {stopNativeBallAssist();state.autoObservations=[];}
  groundPan = null;
  groundPanDragged = false;
  syncGroundView(null);
});

window.addEventListener("resize", () => { syncCanvasSize(); updateGroundView(); });
setInterval(() => {
  if (document.visibilityState === "visible") syncCanvasSize();
}, 1000);
