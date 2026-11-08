import json
from pathlib import Path
from PIL import Image,ImageDraw
root=Path(__file__).resolve().parents[2]/'demo-output/ball-assist-lab'
report=json.loads((root/'benchmark.json').read_text())
for row in report['rows']:
 points=[p for p in row['held_out'] if p.get('suggested')]
 if not points:continue
 sheet=Image.new('RGB',(400*len(points),330),'#e4eee7');draw=ImageDraw.Draw(sheet)
 for index,point in enumerate(points):
  x,y=point['manual'];origin=(int(x)-25,int(y)-20)
  image=Image.open(root/row['session']/'frames'/f"frame-{point['frame']+1:05}.jpg")
  image=image.crop((*origin,origin[0]+50,origin[1]+40)).resize((400,280))
  sheet.paste(image,(400*index,35));draw.text((400*index+10,7),f"Frame {point['frame']}: red=manual, orange=suggested",fill='black')
  for xy,color in [(point['manual'],'red'),(point['suggested'],'orange')]:
   xx=400*index+(xy[0]-origin[0])*8;yy=35+(xy[1]-origin[1])*7
   draw.ellipse((xx-8,yy-8,xx+8,yy+8),outline=color,width=2)
 sheet.save(root/f"heldout-review-{row['hit_id']}.png")
