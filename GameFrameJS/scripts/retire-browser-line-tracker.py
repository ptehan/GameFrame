from pathlib import Path
import shutil,re
ROOT=Path(__file__).resolve().parents[1];p=ROOT/'ev-predictor/app.js';s=p.read_text()
a=s.index('async function captureDetectionFrame(');b=s.index('function acceptAutoTrack(',a)
gaps=s[s.index('function ballAnchorFrameGap()',a):s.index('function supportedForwardProgress(',a)]
s=s[:a]+gaps+s[b:]
s=re.sub(r'^.*(?:detectFlight: document|els\.detectFlight\.addEventListener|if \(els\.detectFlight\) els\.detectFlight\.disabled).*\n','',s,flags=re.M)
a=s.index('function editWorkflowBallMark(');b=s.index('function contactMarkingPrompt(',a);s=s[:a]+s[b:]
a=s.index('    els.setupControlsSlot.innerHTML = `<div id="workflow-detect-working"');b=s.index('\n    return;',a)
s=s[:a]+'    els.setupControlsSlot.innerHTML = "";'+s[b:]
s=s.replace('function setClickMode(mode) {','function setClickMode(mode) {\n  if (!["ball", "landmark", "terminal", "eraser"].includes(mode)) mode = "ball";')
s=s.replace("message:'Detected ball marks accepted. Continue to field marks.'", "message:'Detected ball marks accepted. Choose \"Continue to field marks\".'")
p.write_text(s)
p=ROOT/'ev-predictor/predictor.html';s=p.read_text();s=re.sub(r'^.*id="detect-flight".*\n','',s,flags=re.M);p.write_text(s)
# Keep the retired algorithm's checks as historical research, outside active tests.
retired=ROOT/'experiments/retired-browser-line-tracker';retired.mkdir(parents=True,exist_ok=True)
for name in ['ev-browser-tracking.test.cjs','ev-line-boundary.test.cjs']:
    source=ROOT/'test'/name;target=retired/name
    if source.exists() and not target.exists():shutil.move(str(source),str(target))
(retired/'README.txt').write_text('Retired November 7, 2026. These checked the removed browser line-guided tracker. The app now uses native automatic ball assistance and manual interval tags. Backend trajectory inference and physical-model tests remain active. These historical checks are not part of the active test suite.\n')
p=ROOT/'test/ev-third-ball-mark.test.cjs';s=p.read_text().replace("source.indexOf('function supportedForwardProgress(')","source.indexOf('function acceptAutoTrack(')");p.write_text(s)
print('Retired browser line detector and its dead controls; retained manual frame intervals and native ball assistance.')
