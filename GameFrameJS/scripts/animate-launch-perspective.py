"""Illustrate public projection geometry; this is not GameFrame's inference code."""
import json, math, subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root=Path(__file__).resolve().parents[1]
folder=root/'demo-output/gameframe-polished/technical'
assets=folder/'assets';assets.mkdir(exist_ok=True)
width,height,fps,duration=1280,654,30,22
output=assets/'launch-perspective.mp4'
green='#143c2b';muted='#526b5c';blue='#447eb0';gold='#c69b24';background='#f1f6f2'
def font(size,bold=False):return ImageFont.truetype('C:/Windows/Fonts/arial'+('bd' if bold else '')+'.ttf',size)
def arrow(draw,a,b,fill,width=3,size=10):
 draw.line([a,b],fill=fill,width=width)
 angle=math.atan2(b[1]-a[1],b[0]-a[0])
 draw.polygon([b,(b[0]-size*math.cos(angle-.45),b[1]-size*math.sin(angle-.45)),(b[0]-size*math.cos(angle+.45),b[1]-size*math.sin(angle+.45))],fill=fill)
def project(x,y,z):return (260+230*x,460-230*y)
def smooth(x):x=max(0,min(1,x));return x*x*(3-2*x)
def direction(time):
 if time<3.5:return 0
 if time<11.5:return 65*smooth((time-3.5)/8)
 if time<18.5:return 65
 return 65*(1-smooth((time-18.5)/3.5))
theta=math.radians(21)
def geometry(phi):
 phi=math.radians(phi);horizontal=400*math.cos(phi);rise=400*math.tan(theta)
 return horizontal,rise,math.degrees(math.atan2(rise,horizontal))
across=geometry(0);away=geometry(65)
assert abs(across[2]-21)<1e-10 and away[2]>across[2]
assert away[0]<across[0] and away[1]==across[1]
base=Image.new('RGB',(width,height),background);draw=ImageDraw.Draw(base)
logo=Image.open(root/'static/logo/gameframe-logo-app.png').convert('RGBA');logo.thumbnail((205,60));base.paste(logo,(44,26),logo)
draw.text((720,37),'Same launch angle. Different direction.',font=font(22,True),fill=green)
for box in [(40,105,615,604),(665,105,1240,604)]:draw.rounded_rectangle(box,radius=16,fill='white',outline='#d0ded4',width=2)
draw.text((70,126),'FIELD DIRECTION · TOP VIEW',font=font(18,True),fill=muted)
draw.text((695,126),'CAMERA VIEW',font=font(18,True),fill=muted)
draw.text((70,162),'Launch angle: 21°',font=font(28,True),fill=green)
for i in range(6):
 x=-.6+i*.39;draw.line([project(x,0,0),project(x,1,0)],fill='#d9e4dd',width=2)
 y=i*.2;draw.line([project(-.6,y,0),project(1.35,y,0)],fill='#d9e4dd',width=2)
draw.rounded_rectangle((239,535,279,562),radius=4,fill=green)
draw.polygon([(247,535),(247,525),(270,525),(270,535)],fill=green)
arrow(draw,(260,525),(260,490),muted,width=2,size=8)
draw.text((226,573),'Camera',font=font(17),fill=muted)
draw.text((1112,302),'Same rise',font=font(19),fill=blue)
arrow(draw,(1190,495),(1190,495-across[1]),blue,width=3,size=10)
arrow(draw,(1190,495-across[1]),(1190,495),blue,width=3,size=10)
draw.text((782,543),'Horizontal travel on screen',font=font(19),fill=muted)
draw.text((44,627),'Illustrative level-camera projection of initial flight · not a measured hit or accuracy test',font=font(16),fill=muted)
ffmpeg=root/'node_modules/ffmpeg-static/ffmpeg.exe'
process=subprocess.Popen([str(ffmpeg),'-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{width}x{height}','-r',str(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-threads','2','-movflags','+faststart',str(output)],stdin=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=subprocess.CREATE_NO_WINDOW)
try:
 for index in range(fps*duration):
  time=index/fps;phi=direction(time);horizontal,rise,apparent=geometry(phi)
  image=base.copy();d=ImageDraw.Draw(image)
  d.text((70,207),'Across the view' if phi<5 else 'Traveling partly away',font=font(21),fill=blue)
  d.text((695,162),f'Image angle: {apparent:.0f}°',font=font(28,True),fill=green)
  angle=math.radians(phi);ground=project(math.cos(angle),math.sin(angle),0);end=project(math.cos(angle),math.sin(angle),math.tan(theta));origin=project(0,0,0)
  arrow(d,origin,ground,blue,width=4,size=12)
  end=ground
  u=(time%2.5)/2.5;ball=(origin[0]+u*(end[0]-origin[0]),origin[1]+u*(end[1]-origin[1]));d.ellipse((ball[0]-7,ball[1]-7,ball[0]+7,ball[1]+7),fill=green,outline='white',width=2)
  screen=(730,495);target=(730+horizontal,495-rise)
  d.line([screen,(1130,495)],fill='#d8dfda',width=3)
  arrow(d,screen,target,gold,width=6,size=14)
  arrow(d,(730,518),(730+horizontal,518),blue,width=3,size=9)
  arrow(d,(730+horizontal,518),(730,518),blue,width=3,size=9)
  d.line([target,(target[0],495)],fill='#bed0c3',width=2)
  d.arc((675,440,785,550),-apparent,0,fill=green,width=3)
  ball=(screen[0]+u*horizontal,screen[1]-u*rise);d.ellipse((ball[0]-7,ball[1]-7,ball[0]+7,ball[1]+7),fill=green,outline='white',width=2)
  if index in [30,16*fps]:image.save(assets/('perspective-across.png' if index==30 else 'perspective-away.png'))
  process.stdin.write(image.tobytes())
 process.stdin.close();error=process.stderr.read().decode(errors='replace');code=process.wait()
 if code:raise RuntimeError(error)
except Exception:
 process.kill();raise
report={'video':str(output),'duration_s':duration,'frames':fps*duration,'illustrative_only':True,'launch_angle_deg':21,'across_image_angle_deg':across[2],'away_image_angle_deg':away[2],'horizontal_screen_travel_shrinks':True,'vertical_rise_constant':True}
(assets/'perspective-check.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report),flush=True)
