"""Draw a standalone diagnostic SVG from the read-only video-fit comparison."""
import html
import json
import math
import sys
from pathlib import Path

source = Path(sys.argv[1])
data = json.loads(source.read_text(encoding='utf-8'))
matches = data['matches']
colors = ['#1769bc', '#c34a17', '#13805c', '#8b43af', '#aa7900']
svg = ['<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1040" viewBox="0 0 1200 1040">', '<rect width="1200" height="1040" fill="#f4f6f8"/>']
def text(x,y,value,size=16,color='#263442',anchor='start'):
    svg.append(f'<text x="{x}" y="{y}" font-family="Arial,sans-serif" font-size="{size}" fill="{color}" text-anchor="{anchor}">{html.escape(str(value))}</text>')
def path(points,color,width=3,dash=''):
    pts=' '.join(f'{x:.2f},{y:.2f}' for x,y in points)
    svg.append(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="{width}" stroke-dasharray="{dash}"/>')
def dot(x,y,color,r=4):
    svg.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{r}" fill="{color}"/>')
text(35,40,f"Hit #{data['saved_hit_id']} — best synthetic fits to the timed video points",25)
text(35,69,'All directions searched. Ranked by projected pixel error; entered distance does not affect ranking.',16)
text(35,95,f"{data['performance']['database_count']:,} stored trajectories; {data['performance']['scored_count']:,} camera-valid candidates; {data['used_count']} timed flight points.",15)
for x in (30,620):
    svg.append(f'<rect x="{x}" y="115" width="550" height="390" rx="12" fill="white" stroke="#d5dce1"/>')
text(50,145,'Field diagram · actual stored directions',19)
text(640,145,'Side view · height above field',19)
curves=[c['trajectory_points'] for c in matches]
reach=max(350,max(math.hypot(p['x_ft'],p['y_ft']) for curve in curves for p in curve))*1.06
scale=min(230/(reach*.72),300/reach)
fx=lambda x:305+x*scale
fy=lambda y:470-y*scale
r=reach*scale
q=r/math.sqrt(2)
svg.append(f'<path d="M305 470 L{305-q} {470-q} A{r} {r} 0 0 1 {305+q} {470-q} Z" fill="#e5efdf" stroke="#9eb997"/>')
for distance in range(100,int(reach),100):
    rr=distance*scale;qq=rr/math.sqrt(2)
    svg.append(f'<path d="M{305-qq} {470-qq} A{rr} {rr} 0 0 1 {305+qq} {470-qq}" fill="none" stroke="#a8bba2" stroke-dasharray="4 4"/>')
    text(310,470-rr-3,f'{distance} ft',11)
b=90/math.sqrt(2)
path([(305,470),(fx(-b),fy(b)),(305,fy(b*2)),(fx(b),fy(b)),(305,470)],'#a78c61',2)
text(305,493,'Home',13,anchor='middle')
maxz=max(60,max(p['z_ft'] for curve in curves for p in curve))*1.15
hx=lambda d:675+d/reach*460
hy=lambda z:460-z/maxz*270
path([(675,175),(675,460),(1140,460)],'#73808a',1)
for z in range(0,int(maxz),20):
    path([(675,hy(z)),(1140,hy(z))],'#e1e6e9',1)
    text(665,hy(z)+4,str(z),12,anchor='end')
for d in range(0,int(reach),100):text(hx(d),480,str(d),12,anchor='middle')
text(900,498,'Distance from home (ft)',13,anchor='middle')
text(680,175,'Height (ft)',12)
for i,curve in enumerate(curves):
    path([(fx(p['x_ft']),fy(p['y_ft'])) for p in curve],colors[i],2.5)
    path([(hx(math.hypot(p['x_ft'],p['y_ft'])),hy(p['z_ft'])) for p in curve],colors[i],2.5)
text(40,542,'Video projection check · black crosses are the saved observations',20)
observed=[p['observed_px'] for p in data['points']]
pixels=observed+[p for match in matches for p in match['projected_pixels']]
minx,maxx=min(p[0] for p in pixels),max(p[0] for p in pixels)
miny,maxy=min(p[1] for p in pixels),max(p[1] for p in pixels)
vs=min(1020/max(1,maxx-minx),220/max(1,maxy-miny))
vx=lambda x:90+(x-minx)*vs
vy=lambda y:575+(y-miny)*vs
for i,match in enumerate(matches):
    path([(vx(p[0]),vy(p[1])) for p in match['projected_pixels']],colors[i],2,'5 4')
    for p in match['projected_pixels']:dot(vx(p[0]),vy(p[1]),colors[i],3)
for p,point in zip(observed,data['points']):
    x,y=vx(p[0]),vy(p[1]);path([(x-6,y),(x+6,y)],'#111',2);path([(x,y-6),(x,y+6)],'#111',2)
    text(x+9,y-9,f"{point['time_s']:.3f}s",12)
for x,label in [(50,'Rank'),(135,'Speed'),(250,'Launch'),(360,'Spray'),(470,'Distance'),(610,'Hang time'),(770,'Video error (RMS)')]:
    text(x,840,label,16)
for i,m in enumerate(matches):
    y=873+i*28;dot(44,y-5,colors[i],5)
    text(60,y,str(i+1),16,colors[i]);text(135,y,f"{m['exit_velocity_mph']:.0f} mph");text(250,y,f"{m['launch_angle_deg']:.0f}°")
    text(360,y,f"{m['spray_angle_deg']:.0f}°");text(470,y,f"{m['distance_ft']:.1f} ft");text(610,y,f"{m['hang_time_s']:.2f} s")
    text(770,y,f"{m['projected_path_rmse_px']:.2f} px",16,colors[i])
text(40,1020,'Diagnostic comparison of existing database trajectories; the saved prediction is unchanged.',13)
svg.append('</svg>')
output=source.with_suffix('.svg');output.write_text('\n'.join(svg),encoding='utf-8');print(output)
