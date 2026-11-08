from pathlib import Path
from PIL import Image, ImageDraw

folder=Path('C:/Users/Patrick/AppData/Local/Temp/gf-hit-visual-inspection')
times=[5+i*.1 for i in range(13)]
for page in range(0,len(times),6):
    sheet=Image.new('RGB',(1200,990),'white')
    draw=ImageDraw.Draw(sheet)
    for i,t in enumerate(times[page:page+6]):
        path=folder/f'frame-{t:.3f}.png'
        if not path.exists():
            continue
        im=Image.open(path).crop((200,180,500,495)).resize((600,630))
        im=im.resize((400,630))
        x,y=(i%3)*400,(i//3)*495
        im=Image.open(path).crop((180,150,580,620))
        sheet.paste(im,(x,y+25))
        draw.text((x+10,y+5),f'{t:.3f}s crop x180..580 y150..620',fill='black')
    out=folder/f'crop-{page//6}.png'
    sheet.save(out)
    print(out)
