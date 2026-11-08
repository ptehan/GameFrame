from pathlib import Path
import json,re
ROOT=Path(__file__).resolve().parents[1];out=ROOT/'output/copy-review'
rows=json.loads((out/'GameFrame-Message-Inventory.json').read_text(encoding='utf-8'))['messages']
labels={'index':'Home','base':'Menu and shared windows','multi_swing':'Choose a swing recording','upload_swing':'Upload a swing','upload_swing_trim':'Crop and tag swing timing','upload_pitch':'Upload a pitch','upload_pitch_trim':'Crop and mark pitch contact','pitch_release_test':'Pitch distance, release and speed','matchup_select':'Create a matchup','library':'View saved videos','dashboard_player':'Player dashboard — Timing','dashboard_measurements':'Player dashboard — Hitting and Pitching','manage_entities':'Manage teams and players','auth_login':'Sign in','account':'Account','data_settings':'Data settings','privacy':'Privacy','terms':'Terms','getting_started':'Getting started','external_video':'Import a video link','external_video_trim':'Choose a window from imported video'}
sections={};seen=set()
for r in rows:
    src=r['source'];kind=r['kind'];t=r['text']
    if 'candidate' in kind.lower() or kind in ['aria-label','alt','data-modal-title']:continue
    if not src.startswith(('templates/','static/js/','ev-predictor/')) or src.endswith('.py'):continue
    if re.search(r'(?:Release debug|Ball debug|debug:|console\.|data-[a-z]|textContent|className|innerHTML|escapeHtml|\.toFixed\(|querySelector|^on[A-Z]|^#[A-Za-z]|^&)',t):continue
    if re.fullmatch(r'[A-Za-z]+(?:-[A-Za-z]+)+',t):continue
    if t in ['GET','POST','DELETE','Content-Type','AbortError','TypeError','Error','aria-live','application/json']:continue
    # These belong to permanently hidden, pre-guided pitch/swing tools.
    if src in ['templates/upload_swing_trim.html','templates/upload_pitch_trim.html'] and re.search(r'pose|stick figure|graphs \+ csv|autodetect|auto detect|lock subject|locked at frame|copy yet|csv|Contact A|Contact B|Contact C|Save will start immediately|Detecting pitched ball|plate.*detect|ball release found|Set contact manually',t,re.I):continue
    if src.startswith('templates/'):section=labels.get(Path(src).stem,'Watch and download saved videos' if '/play_' in src else 'Other app screens')
    elif 'workflow-help' in src:section='Help shown with each step'
    elif src.startswith('ev-predictor/') or any(k in src for k in ['ev-','ball-','contact-review']):section='EV measurement — instructions, status and alerts'
    elif 'pitch' in src:section='Pitch timing — instructions, status and alerts'
    elif 'tag-frames' in src:section='Swing timing — instructions, status and alerts'
    else:section='Shared app instructions and alerts'
    if (section,t) in seen:continue
    seen.add((section,t));sections.setdefault(section,[]).append(t)
order=['Home','Menu and shared windows','EV measurement — instructions, status and alerts','Choose a swing recording','Upload a swing','Crop and tag swing timing','Swing timing — instructions, status and alerts','Upload a pitch','Crop and mark pitch contact','Pitch distance, release and speed','Pitch timing — instructions, status and alerts','Create a matchup','View saved videos','Watch and download saved videos','Player dashboard — Timing','Player dashboard — Hitting and Pitching','Manage teams and players','Help shown with each step','Sign in','Account','Data settings','Getting started','Import a video link','Choose a window from imported video','Shared app instructions and alerts','Other app screens','Privacy','Terms']
lines=['GAMEFRAME — TEXT PEOPLE READ IN THE APP','','Current screen headings, instructions, buttons, field labels, Help and app alerts.','Button references within instructions use double quotes. {value} represents an app-supplied value; [OR] separates conditional alternatives.','Retired brush/line tracking and permanently hidden pre-guided controls are excluded.','']
for section in order:
    if section in sections:lines+=['',section.upper(),'='*len(section),'']+['• '+t for t in sections[section]]
text='\n'.join(lines)+'\n';assert 'Draw Flight Line' not in text and 'Detect Ball Path' not in text
(out/'GameFrame-On-Screen-Text.txt').write_text(text,encoding='utf-8')
print(json.dumps({'messages':sum(map(len,sections.values())),'sections':len(sections),'file':str(out/'GameFrame-On-Screen-Text.txt')}))
