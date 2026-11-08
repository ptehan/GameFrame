from pathlib import Path
from html.parser import HTMLParser
import re,json,hashlib,html,ast
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/copy-review';OUT.mkdir(parents=True,exist_ok=True)
rows=[]
def clean(s):
    s=html.unescape(s)
    s=re.sub(r'{%\s*(?:else|elif\b.*?)\s*%}',' [OR] ',s,flags=re.S)
    s=re.sub(r'{%.*?%}',' ',s,flags=re.S)
    return re.sub(r'\s+',' ',s).strip()
def group(p):
    s=str(p).replace('\\','/')
    if s.startswith('ev-predictor/'):return '02 Exit velocity: map, contact, flight, field marks, estimates and video'
    if 'workflow-help' in s:return '12 Help and step guidance'
    if 'pitch' in s:return '04 Pitch upload, crop, contact, release and speed'
    if 'swing' in s or 'tag-frames' in s:return '03 Swing upload, crop and timing'
    if 'matchup' in s:return '05 Matchup selection, creation and playback'
    if 'dashboard' in s:return '07 Player dashboard'
    if 'library' in s:return '06 Saved videos and library actions'
    if any(t in s for t in ['account','auth','data_settings','privacy','terms','usage-auth']):return '09 Account, sign-in, usage and data'
    if 'manage_entities' in s:return '08 Teams and players'
    if s=='server.js':return '11 Server responses and validation'
    if any(t in s for t in ['ev-video','ev-draft','ball-','contact-review','ev-estimate','ev-dialog']):return '02 Exit velocity: map, contact, flight, field marks, estimates and video'
    return '01 Home, navigation, upload selection and shared messages'
def add(p,line,text,kind,context=''):
    text=mask_values(text)
    text=clean(text)
    if not text or text in ['{{ sid }}','{{ message }}'] or not re.search('[A-Za-z]',text):return
    if re.fullmatch(r'\$\{.*\}|{{.*}}',text,flags=re.S):return
    if not re.search(r'[A-Za-z]{2,}',re.sub(r'\{\{.*?\}\}|\{value\}','',text)):return
    if re.search(r'\bfunction\s+\w+|\b(?:const|let|var)\s+\w+\s*=|=>|\.innerHTML\s*=|\}\s*(?:else|catch)|return\s*;|^`|^;',text):return
    if re.fullmatch(r'[a-z][a-z0-9_.-]*',text) and kind not in ['Page text','title','placeholder','aria-label']:return
    if text.startswith(('&kind=','&sid=','?id=','&embedded=')):return
    rows.append(dict(group=group(p),source=str(p).replace('\\','/'),line=line,kind=kind,text=text,context=clean(context)[:260],proposed=''))
class TextParser(HTMLParser):
    def __init__(self,p,offset=0,kind='Page text'):super().__init__(convert_charrefs=True);self.p=p;self.line_base=offset;self.skip=0;self.kind=kind;self.visibility=[]
    def handle_starttag(self,t,a):
        attrs=dict(a);classes=set((attrs.get('class') or '').split())
        hidden=(self.visibility[-1][1] if self.visibility else False) or attrs.get('id') in {'sidebar-deleted-controls','trim_workspace','pose_gate_notice','autodetect_splash'} or bool(classes & {'mode-toggle','trim-hidden-panel','trim-row-2','trim-row-3','frame-modal-note','pending-batch-drawer'})
        if t not in {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}:self.visibility.append((t,hidden))
        if t in ['script','style']:self.skip+=1
        if self.skip or hidden:return
        for k,v in a:
            if k in ['title','placeholder','aria-label','alt','data-modal-title'] and v:add(self.p,self.line_base+self.getpos()[0],v,k)
            if t=='input' and k=='value' and dict(a).get('type') in ['submit','button','reset']:add(self.p,self.line_base+self.getpos()[0],v,'Button')
    def handle_endtag(self,t):
        if t in ['script','style']:self.skip=max(0,self.skip-1)
        for i in range(len(self.visibility)-1,-1,-1):
            if self.visibility[i][0]==t:self.visibility=self.visibility[:i];break
    def handle_data(self,d):
        if not self.skip and not (self.visibility and self.visibility[-1][1]):add(self.p,self.line_base+self.getpos()[0],d,self.kind)
def string_end(s,i,q):
    j=i+1
    while j<len(s):
        if s[j]=='\\':j+=2;continue
        if q=='`' and s.startswith('${',j):
            depth=1;j+=2
            while j<len(s) and depth:
                if s[j] in "'\"`":j=string_end(s,j,s[j])+1;continue
                if s[j]=='{':depth+=1
                elif s[j]=='}':depth-=1
                j+=1
            continue
        if s[j]==q:return j
        j+=1
    return len(s)-1
def mask_values(s):
    out=[];i=0
    while i<len(s):
        if s.startswith('${',i):
            depth=1;j=i+2
            while j<len(s) and depth:
                if s[j] in "'\"`":j=string_end(s,j,s[j])+1;continue
                if s[j]=='{':depth+=1
                elif s[j]=='}':depth-=1
                j+=1
            out.append('{value}');i=j
        else:out.append(s[i]);i+=1
    return ''.join(out)
def literals(s):
    i=0
    while i<len(s):
        if s.startswith('//',i):
            end=s.find('\n',i);i=len(s) if end<0 else end+1;continue
        if s.startswith('/*',i):
            end=s.find('*/',i+2);i=len(s) if end<0 else end+2;continue
        if s[i] in "'\"`":
            j=string_end(s,i,s[i]);yield i,s[i+1:j];i=j+1
        else:i+=1
def decode(s):
    return re.sub(r'\\([nrt\'"`\\])',lambda m:{'n':' ','r':' ','t':' '}.get(m[1],m[1]),s)
def js(p,s,offset=0,backend=False,force_ui=False):
    for pos,raw in literals(s):
        text=decode(raw);ctx=s[max(0,pos-150):min(len(s),pos+len(raw)+90)]
        line=offset+s.count('\n',0,pos)+1
        if '${' in raw:
            i=0
            while i<len(raw):
                at=raw.find('${',i)
                if at<0:break
                j=at+2;depth=1
                while j<len(raw) and depth:
                    if raw[j] in "'\"`":j=string_end(raw,j,raw[j])+1;continue
                    if raw[j]=='{':depth+=1
                    elif raw[j]=='}':depth-=1
                    j+=1
                js(p,raw[at+2:j-1],line-1+raw.count('\n',0,at+2),force_ui=True);i=j
        if backend and '<' not in text and not re.search(r'error\s*:|message\s*:|\.send\(|new Error\(|new TypeError\(|\.json\(',s[max(0,pos-150):pos]):continue
        if '<' in text and re.search(r'<(?:div|p|span|button|option|label|h[1-6]|section|strong|summary|select|a|input)\b',text):
            parser=TextParser(p,line-1,'Dynamic UI text');
            try:parser.feed(mask_values(text))
            except Exception:pass
            continue
        t=clean(text)
        if not t or len(t)>1600:continue
        if re.search(r'^(SELECT |INSERT |UPDATE |DELETE |CREATE |PRAGMA |ALTER |https?://|blob:|data:|/|\.|#)',t,re.I):continue
        if re.search(r'\b(?:document\.|querySelector|classList|function\b|=>|padding:|display:|border:|font-size:|SELECT .* FROM)\b',t):continue
        if not re.search(r'[A-Za-z]{2,}',t):continue
        ui=force_ui or bool(re.search(r'textContent|innerHTML|title\s*[:=]|copy\s*:|label\s*:|action\s*:|message|Prompt|Status|Error|alert\(|confirm\(|placeholder|aria-label|\.send\(|\.json\(',ctx,re.I))
        words=re.findall(r'[A-Za-z]+',re.sub(r'\$\{.*?\}','value',t))
        if len(words)<2 and (not ui or not t[:1].isupper()):continue
        if len(words)<2 and (len(t)>34 or re.search(r'[_./#{}:;=]',t)):continue
        if not ui and (len(words)<3 or not re.search(r'[ .?!]',t)):continue
        if re.fullmatch(r'[a-z0-9_-]+(?: [a-z0-9_-]+)*',t) and not ui:continue
        kind='Error / validation' if re.search(r'error|Error|alert\(',ctx) else 'Message / label' if ui else 'Source candidate — check visibility'
        add(p,line,t,kind,ctx)

templates=sorted((ROOT/'templates').glob('*.html'))
excluded={'upload_swing_trim - Copy.html'}
for f in templates:
    if f.name in excluded:continue
    p=f.relative_to(ROOT);s=f.read_text(encoding='utf-8-sig');parser=TextParser(p);parser.feed(s)
    for m in re.finditer(r'<script\b[^>]*>(.*?)</script>',s,re.S|re.I):js(p,m[1],s.count('\n',0,m.start(1)))
for f in sorted((ROOT/'ev-predictor').glob('*.html')):
    p=f.relative_to(ROOT);s=f.read_text(encoding='utf-8-sig');TextParser(p).feed(s)
for f in [ROOT/'ev-predictor/app.js',*sorted((ROOT/'static/js').glob('*.js')),*sorted(ROOT.glob('*.js')),*sorted((ROOT/'desktop').glob('*.js'))]:
    if f.exists():js(f.relative_to(ROOT),f.read_text(encoding='utf-8-sig'),backend=f.parent==ROOT)
for f in sorted((ROOT/'ev-predictor').glob('*.py')):
    s=f.read_text(encoding='utf-8-sig');tree=ast.parse(s);source_lines=s.splitlines()
    for node in ast.walk(tree):
        if not isinstance(node,ast.Constant) or not isinstance(node.value,str):continue
        text=node.value;ctx=' '.join(source_lines[max(0,node.lineno-2):node.end_lineno])
        if len(text)<8 or len(text)>1600 or len(re.findall('[A-Za-z]+',text))<3:continue
        if re.search(r'\b(?:raise|error|message|status|detail)\b',ctx,re.I):add(f.relative_to(ROOT),node.lineno,text,'Server / worker message candidate',ctx)
unique={}
for r in rows:
    key=(r['group'],r['text'])
    if key in unique:unique[key]['also_at'].append(f"{r['source']}:{r['line']}");continue
    r['also_at']=[];r['id']='GF-'+hashlib.sha1((r['group']+'|'+r['text']).encode()).hexdigest()[:8].upper();unique[key]=r
rows=sorted(unique.values(),key=lambda r:(r['group'],r['source'],r['line']))
data={'generated':'2026-11-07','scope':'Current canonical source; source-defined text, conditional branches and source candidates. Not proof that every string is currently reachable. Dynamic server/browser/library exception text is unbounded and not enumerated. No application wording changed.','excluded':['Legacy duplicate upload_swing_trim - Copy.html','Vendor libraries','External operating-system file picker and browser-generated messages'],'messages':rows}
(OUT/'GameFrame-Message-Inventory.json').write_text(json.dumps(data,indent=2,ensure_ascii=False),encoding='utf-8')
lines=['GAMEFRAME — USER MESSAGE WORDING REVIEW','Generated November 7, 2026','','HOW TO EDIT','Keep each GF- identifier. Write replacements on the REVISED line. Use DELETE to remove a message. {value} and {{...}} represent app-supplied values. [OR] separates conditional alternatives retained from a template. The JSON inventory preserves source context.','This is a source audit, not a claim that every message is currently visible. Hidden controls, legacy branches, Help, accessibility labels and conditional errors are included. Source candidates need a visibility check before implementation. Browser/file-picker text and arbitrary third-party exception details cannot be exhaustively listed.','No app wording has been changed.','']
current=None
for r in rows:
    if current!=r['group']:current=r['group'];lines+=['','='*78,current.upper(),'='*78,'']
    lines += [r['id']+' | '+r['kind'],'SOURCE: '+r['source']+':'+str(r['line']),'CURRENT: '+r['text'],'REVISED: ','']
(OUT/'GameFrame-All-User-Messages-Review.txt').write_text('\n'.join(lines),encoding='utf-8')
section_dir=OUT/'By-section';section_dir.mkdir(exist_ok=True)
for name in sorted(set(r['group'] for r in rows)):
    section=[name.upper(),'','Edit REVISED lines; keep IDs. Hidden/source-candidate wording is not the current on-screen list.','']
    for r in rows:
        if r['group']==name:section += [r['id']+' | '+r['kind'],'SOURCE: '+r['source']+':'+str(r['line']),'CURRENT: '+r['text'],'REVISED: ','']
    (section_dir/(re.sub(r'[^A-Za-z0-9 -]','',name)[:110]+'.txt')).write_text('\n'.join(section),encoding='utf-8')
print(json.dumps({'messages':len(rows),'groups':{g:sum(r['group']==g for r in rows) for g in sorted(set(r['group'] for r in rows))}},indent=2))

