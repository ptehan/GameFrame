from pathlib import Path
import re,shutil
ROOT=Path(__file__).resolve().parents[1]
backup=ROOT/'demo-output/copy-cleanup-before';backup.mkdir(parents=True,exist_ok=True)
def save(file,s):
    p=ROOT/file;b=backup/file;b.parent.mkdir(parents=True,exist_ok=True)
    if not b.exists():shutil.copy2(p,b)
    p.write_text(s,encoding='utf-8')
file='ev-predictor/app.js';s=(ROOT/file).read_text(encoding='utf-8-sig')
def cut(a,b):
    global s
    start=s.index(a);end=s.index(b,start);s=s[:start]+s[end:]
cut('function detectionBrushHasPoints() {','function visibleObservationsFromCurrentTimeOnward() {')
cut('async function runWorkflowBallDetection(','function normalizeObservationRows(')
# This implementation returned after its server fallback. Everything between that
# return and the catch was an earlier, unreachable in-browser tracker.
a=s.index('    const step = currentStep();',s.index('async function detectFlightFromVideo()'))
b=s.index('  } catch (error) {',a);s=s[:a]+s[b:]
cut('function estimateContactAnchor(scale) {','function imageDirectionPrior() {')
cut('els.overlay.addEventListener("pointerdown", (event) => {\n  if (!wizardEditingActive()) return;\n  if (els.clickMode.value !== "brush") return;', 'els.overlay.addEventListener("click", async (event) => {')
s=re.sub(r'^.*(?:detectionBrush: \[\]|brushDrawing: false|brushStart: null|modeBrush:|clearDetectionBrush:|state\.detectionBrush = \[\];|state\.brushDrawing = false;|state\.brushStart = null;|els\.modeBrush\.addEventListener|els\.clearDetectionBrush\?\.addEventListener|drawDetectionBrushOverlay\(\);|clearDetectionBrush\(\);).*\n','',s,flags=re.M)
s=s.replace('  els.modeBrush.classList.toggle("active", mode === "brush");\n','')
a=s.index('  if (mode === "brush" && !detectionBrushHasPoints()) {');b=s.index('\n  }',a)+4;s=s[:a]+s[b:]
s=s.replace('els.overlay.style.cursor = mode === "eraser" ? "cell" : (mode === "brush" ? "cell" : "crosshair");','els.overlay.style.cursor = mode === "eraser" ? "cell" : "crosshair";')
s=s.replace('  if (els.clickMode.value === "brush") return;\n','')
s=s.replace('["ball", "brush", "eraser"]','["ball", "eraser"]')
s=s.replace('  const usedBrush = detectionBrushHasPoints();\n','')
s=s.replace('  ) || usedBrush;','  );')
s=s.replace('  const trustedBrushGuided = usedBrush && support >= 3 && missing <= 1 && avgCandidateDistance <= 18;\n','')
s=s.replace(' && !trustedBrushGuided','')
s=s.replace('escapeHtml(usedBrush ? "brush-guided search" : source)','escapeHtml(source)')
# Retain point-derived seed data and its saved-package key; no drawn-line UI remains.
a=s.index('  if (detectionBrushHasPoints()) {',s.index('function detectionBrushPackage()'))
b=s.index('  const manualBallPoints',a);s=s[:a]+s[b:]
s=s.replace('function detectionBrushPackage()', 'function manualBallPathHintPackage()').replace('detection_brush: detectionBrushPackage()','detection_brush: manualBallPathHintPackage()')
s=s.replace('Mark a visible baseball point or draw a flight line first. Home plate is never used as a ball detection fallback.','Mark the ball at contact before detecting its flight.')
s=s.replace('    setupWorkflowButton("workflow-retry-detection", () => runWorkflowBallDetection({autoAdvance: true}));\n','')
# These controls are no longer created by the guided workflow.
for control in ['workflow-edit-field-marks','workflow-edit-contact-ball','workflow-edit-flight-ball','workflow-edit-later-ball','workflow-edit-last-ball','workflow-edit-extra-ball','workflow-use-manual-points']:
    s=re.sub(r'^.*setupWorkflowButton\("'+re.escape(control)+r'".*\n','',s,flags=re.M)
a=s.index('function syncDetectFlightButtons() {');b=s.index('\nfunction normalizeObservationRows(',a)
s=s[:a]+'''function syncDetectFlightButtons() {
  const readiness = ballDetectionSeedReadiness();
  if (els.detectFlight) els.detectFlight.disabled = !readiness.ready;
  return readiness;
}
'''+s[b:]
# Remove explanatory copy that was permanently hidden and described a superseded order.
a=s.index('const workflowCopy = {');b=s.index('\nlet activeWorkflowStep',a)
block=re.sub(r'^\s*copy:.*\n','',s[a:b],flags=re.M);s=s[:a]+block+s[b:]
s=s.replace('  els.setupCopy.textContent = meta.copy;','  els.setupCopy.textContent = "";')
s=s.replace('message: "Click the baseball at contact or choose Not visible."', 'message: \'Click the baseball at contact or choose "Not visible".\'')
s=s.replace('frames after contact, or choose Not visible.', 'frames after contact, or choose "Not visible".')
s=s.replace('No more frames in this video. Continue to field marks.', 'No more frames in this video. Choose "Continue to field marks".')
s=s.replace('Use Retry video to try again;', 'Use "Retry video" to try again;')
s=s.replace('Check the suggested field marks. Drag any marker to correct it, then use these marks.', 'Check the suggested field marks. Drag any marker to correct it, then choose "Confirm field marks".')
# The last replacement is inside a single-quoted JS literal and needs no escaping.
save(file,s)
file='ev-predictor/predictor.html';s=(ROOT/file).read_text(encoding='utf-8-sig')
s=re.sub(r'^.*(?:id="mode-brush"|value="brush"|id="clear-detection-brush").*\n','',s,flags=re.M)
s=s.replace('app.js?v=frame-reuse-20261105','app.js?v=copy-cleanup-20261107');save(file,s)
for file in ['ev-predictor/synthetic/trajectory_inference.py','ev-predictor/synthetic/auto_track_ball.py']:
    s=(ROOT/file).read_text(encoding='utf-8-sig').replace('Need a marked baseball point or drawn flight line before tracking.','Mark the ball at contact before detecting its flight.');save(file,s)
file='static/js/workflow-help.js';s=(ROOT/file).read_text(encoding='utf-8-sig')
s=s.replace('choose Not visible or continue to field marking.', 'choose "Not visible" or "Continue to field marks".')
s=s.replace('Click the ball, or choose Not visible. Continue when you are ready.', 'Click the ball, or choose "Not visible". Choose "Continue to field marks" when you are ready.')
s=s.replace('Your earlier player selection is preserved. Review the estimate while the video prepares, then save.', 'Your earlier player selection is preserved. Review the estimate, then choose "Save hit". Your video prepares in the background after saving.')
s=s.replace('Your video prepares automatically. Review the estimate, then save.', 'Review the estimate, then choose "Save hit". Your video prepares in the background.')
s=s.replace('Your player selection is saved. Review the estimate, then save.', 'Your player selection is saved. Review the estimate, then choose "Save hit".')
s=s.replace('use Zoom to adjust its size.', 'use the "Zoom" control to adjust its size.')
s=s.replace('Check both clips, then create the matchup.', 'Check both clips, then choose "Create Matchup".')
save(file,s)
print('Removed obsolete brush UI, unreachable tracker branch and stale workflow copy; updated current instructions.')
