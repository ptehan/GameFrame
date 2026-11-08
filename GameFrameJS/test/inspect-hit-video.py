"""Extract timestamped source frames for visual inspection only."""
import sys
from pathlib import Path
import cv2
from PIL import Image, ImageDraw

out = Path('C:/Users/Patrick/AppData/Local/Temp/gf-hit-visual-inspection')
out.mkdir(exist_ok=True)
cap = cv2.VideoCapture('C:/Users/Patrick/Downloads/1000053313.mp4')
print('fps', cap.get(cv2.CAP_PROP_FPS), 'frames', cap.get(cv2.CAP_PROP_FRAME_COUNT))
start, stop, step = map(float, sys.argv[1:4]) if len(sys.argv)>1 else (2, 12, .5)
times = []
t = start
while t <= stop + .0001:
    times.append(t)
    t += step
for page in range(0, len(times), 8):
    sheet = Image.new('RGB', (1280, 4*385), '#eeeeee')
    draw = ImageDraw.Draw(sheet)
    for i, t in enumerate(times[page:page+8]):
        cap.set(cv2.CAP_PROP_POS_MSEC, t*1000)
        ok, frame = cap.read()
        if not ok:
            continue
        im = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        im.save(out/f'frame-{t:.3f}.png')
        im.thumbnail((640,360))
        x,y=(i%2)*640,(i//2)*385
        sheet.paste(im,(x,y+25))
        draw.text((x+8,y+5),f'{t:.3f} s',fill='black')
    path=out/f'sheet-{start}-{page//8}.jpg'
    sheet.save(path, quality=95)
    print(path)
cap.release()
