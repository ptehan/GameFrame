"""Static Python catalog and read-only database schema. No application imports."""
import ast
import hashlib
import json
from pathlib import Path
import re
import sqlite3

ROOT=Path(__file__).resolve().parents[2]
OUT=Path(__file__).resolve().parent
files=[*sorted((ROOT/'ev-predictor').glob('*.py')),*sorted((ROOT/'ev-predictor/synthetic').glob('*.py'))]
files += [ROOT/'experiments/ball-assist'/name for name in ['tracker.py','contact_scan.py','ground_review.py','bracket_refine.py','frame_source.py','stream_scan.py']]
files += [ROOT/'scripts/pitch_release_yolo.py']
result={'files':[],'functions':[],'classes':[],'routes':[],'environment':[],'cli':[],'errors':[]}
for file in files:
    if not file.exists():continue
    text=file.read_text(encoding='utf-8-sig');relative=file.relative_to(ROOT).as_posix()
    try:tree=ast.parse(text)
    except SyntaxError as error:result['errors'].append({'file':relative,'error':str(error)});continue
    result['files'].append({'file':relative,'lines':len(text.splitlines()),'sha256':hashlib.sha256(text.encode()).hexdigest(),'description':(ast.get_docstring(tree) or '').split('\n')[0]})
    def visit(node,scope=''):
        for child in ast.iter_child_nodes(node):
            if isinstance(child,ast.ClassDef):
                result['classes'].append({'file':relative,'name':child.name,'line':child.lineno,'bases':[ast.unparse(base) for base in child.bases]})
                visit(child,scope+child.name+'.')
            elif isinstance(child,(ast.FunctionDef,ast.AsyncFunctionDef)):
                calls=[]
                for item in ast.walk(child):
                    if isinstance(item,ast.Call):
                        name=ast.unparse(item.func)
                        if name not in calls and len(name)<85:calls.append(name)
                result['functions'].append({'file':relative,'name':scope+child.name,'line':child.lineno,'endLine':child.end_lineno,'signature':'('+ast.unparse(child.args)+')','description':(ast.get_docstring(child) or '').split('\n')[0],'calls':calls[:8],'async':isinstance(child,ast.AsyncFunctionDef)})
                visit(child,scope+child.name+'.')
            else:visit(child,scope)
    visit(tree)
    for node in ast.walk(tree):
        if isinstance(node,ast.Call):
            name=ast.unparse(node.func)
            if name in ('os.environ.get','os.getenv') and node.args and isinstance(node.args[0],ast.Constant):
                result['environment'].append({'file':relative,'line':node.lineno,'name':node.args[0].value,'default':ast.unparse(node.args[1]) if len(node.args)>1 else None})
            if name.endswith('.add_argument') and node.args:
                result['cli'].append({'file':relative,'line':node.lineno,'flags':[arg.value for arg in node.args if isinstance(arg,ast.Constant)],'options':{item.arg:ast.unparse(item.value)[:160] for item in node.keywords}})
        if relative=='ev-predictor/clip_server.py' and isinstance(node,ast.Compare) and isinstance(node.left,ast.Attribute) and ast.unparse(node.left) in ('self.path','parsed.path'):
            paths=[]
            for comparator in node.comparators:
                paths += [item.value for item in ast.walk(comparator) if isinstance(item,ast.Constant) and isinstance(item.value,str) and item.value.startswith('/')]
            method='POST' if ast.unparse(node.left)=='self.path' else 'GET'
            parent=next((candidate for candidate in ast.walk(tree) if isinstance(candidate,ast.If) and candidate.test is node),None)
            segment=ast.get_source_segment(text,parent) if parent else ''
            target=re.search(r'self\.(handle_\w+)\(',segment)
            inputs=sorted(set(re.findall(r'(?:payload|query)\.get\([\'\"]([^\'\"]+)',segment)))
            for endpoint in paths:result['routes'].append({'file':relative,'line':node.lineno,'method':method,'path':endpoint,'handler':target[1] if target else 'inline','inputs':inputs})
schema=[]
database=ROOT/'app.db'
with sqlite3.connect(database.resolve().as_uri()+'?mode=ro',uri=True) as conn:
    conn.row_factory=sqlite3.Row
    for row in conn.execute("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
        name=row['name']
        columns=[dict(column) for column in conn.execute('PRAGMA table_info('+json.dumps(name)+')')]
        indexes=[dict(index) for index in conn.execute('PRAGMA index_list('+json.dumps(name)+')')]
        for index in indexes:index['columns']=[dict(c) for c in conn.execute('PRAGMA index_info('+json.dumps(index['name'])+')')]
        foreign=[dict(c) for c in conn.execute('PRAGMA foreign_key_list('+json.dumps(name)+')')]
        schema.append({'table':name,'columns':columns,'indexes':indexes,'foreign_keys':foreign,'sql':row['sql']})
(OUT/'python-inventory.json').write_text(json.dumps(result,indent=2),encoding='utf8')
(OUT/'schema-inventory.json').write_text(json.dumps(schema,indent=2),encoding='utf8')
print(json.dumps({'python_files':len(result['files']),'functions':len(result['functions']),'classes':len(result['classes']),'routes':len(result['routes']),'tables':len(schema),'errors':result['errors']}))
