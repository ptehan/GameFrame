from pathlib import Path
source=Path('test/ev-point-validation.py').read_text();exec(source[:source.index('reports=[]')])
original=copy.deepcopy(manual);results=[]
for name,order in [('withhold15',[0,1,3,2]),('withhold10',[0,2,3,1])]:
 manual=[original[i] for i in order]
 case=dict(name=name,count=3,variation='baseline',delta=0,angle=0)
 row=run(case);results.append(row);print(json.dumps(row),flush=True)
(OUT/'leave-one-out.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
