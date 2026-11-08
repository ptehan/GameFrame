"""Compose phone-readable instruction frames from captured UI pixels only.

Run again after adding screenshots. Original captures are never modified. Every
crop and placement is recorded in phone-frames/manifest.json for review.
"""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
DEFAULT = ROOT / 'demo-output' / 'gameframe-instructions-refresh'
SIZE = (1280, 654)
BG = '#f1f6f2'
INK = '#163d32'

# Source coordinates are x,y,width,height; placements use the same order.
def tile(box, target, source=None):
    return {'crop': list(box), 'target': list(target), **({'source': source} if source else {})}

def profile(title, *tiles):
    return {'title': title, 'tiles': list(tiles)}

P = {}
P['home'] = profile('Choose the task you want to do',
    tile((33,187,492,84),(30,98,1220,220)),
    tile((540,187,491,84),(30,364,1220,220)))
P['home-saved-videos'] = profile('Return to your saved videos',
    tile((32,483,242,75),(156,180,968,300)))
P['save-hit-control'] = profile('Review the estimate, then save the hit',
    tile((40,268,250,25),(40,118,1200,130)),
    tile((1078,29,80,40),(380,324,520,260)))
P['choose-video'] = profile('Choose the original hit video',
    tile((387,373,300,91),(90,100,1100,260)),
    tile((469,479,126,43),(390,407,500,170)))
P['choose-hitter'] = profile('Select the team and hitter',tile((310,333,445,220),(40,90,1200,540)))
P['field-address'] = profile('Find the actual field',
    tile((234,113,594,163),(25,105,1230,350)),
    tile((743,829,81,35),(460,490,360,150)))
P['ground-choice'] = profile('Can you see first ground contact?',tile((293,373,479,138),(30,115,1220,450)))
P['contact'] = profile('Mark where the bat and ball meet',
    tile((670,435,180,130),(25,80,1230,360)),
    tile((173,780,73,22),(20,478,300,116)),
    tile((822,780,73,22),(342,478,300,116)),
    tile((87,822,139,38),(685,463,565,160)))
P['contact-between-frames'] = profile('Contact can fall between two frames',*P['contact']['tiles'])
P['manual-fallback'] = profile('Mark the ball after contact',
    tile((415,195,105,85),(25,90,735,370)),
    tile((640,440,299,240),(790,90,465,370)),
    tile((174,847,72,21),(30,493,320,116)),
    tile((822,847,73,21),(375,493,320,116)),
    tile((862,31,85,30),(800,475,425,150)))
P['automatic-processing'] = profile('Automatic tracking can be replaced manually',
    tile((612,430,320,250),(25,90,790,370)),
    tile((850,31,96,31),(825,200,430,155)),
    tile((31,29,356,51),(35,485,1210,130)))
P['automatic-review'] = profile('Review every numbered ball position',
    tile((237,209,548,351),(20,88,1240,375)),
    tile((725,30,95,32),(120,495,420,140)),
    tile((828,30,119,32),(675,495,500,140)))
for name, title, action in [
    ('field-marks','Review the suggested field marks',(560,490,470,265)),
    ('field-manual','Tag the visible field landmarks',(440,440,590,325)),
    ('field-rubber','Mark the pitching rubber',(410,420,310,245)),
    ('field-baseline','Mark two points on the baseline',(580,510,450,250)),
]:
    P[name] = profile(title,tile(action,(20,90,1240,390)),tile((31,29,625,51),(30,510,1220,115)))
for name, title in [('map-camera','Place the camera on the correct diamond'),('map-home','Mark home plate'),('map-second','Mark second base')]:
    P[name] = profile(title,
        tile((590,575,445,238),(20,90,1240,375)),
        tile((26,78,241,54),(40,495,530,135)),
        tile((286,109,340,26),(630,505,610,110)))
P['map-comparison'] = profile('Compare your landing mark with the model',
    tile((245,370,584,312),(20,90,1240,390)),
    tile((26,166,391,50),(40,510,1200,115)))
P['map-landing'] = profile('Mark first landing and its certainty',
    tile((245,370,584,312),(20,85,1240,350),'map-comparison.png'),
    tile((767,176,263,96),(25,452,1230,188)))
P['map-landing-certainty'] = profile('Choose the uncertainty of the landing mark',
    tile((767,176,263,96),(35,120,1210,442),'map-landing.png'))
P['library'] = profile('Review saved results in the library',
    tile((157,191,410,131),(20,90,1240,350)),
    tile((989,192,59,79),(420,475,440,150)))
P['saved-estimate'] = profile('Review the saved hit estimate',
    tile((367,63,678,56),(20,80,1240,125)),
    tile((749,280,291,219),(20,225,800,390)),
    tile((376,540,246,33),(840,295,415,180)))
P['swing-first-move'] = profile('Set the first forward swing movement',
    tile((435,249,333,345),(20,83,1240,365)),
    tile((375,764,100,41),(20,490,285,120)),
    tile((591,764,98,41),(325,490,285,120)),
    tile((865,823,174,24),(660,488,600,130)))
P['swing-commitment'] = profile('Mark the same commitment point each time',
    tile((435,249,333,345),(20,83,1240,365)),
    tile((375,764,100,41),(20,490,285,120)),
    tile((591,764,98,41),(325,490,285,120)),
    tile((912,815,133,42),(735,488,430,130)))
P['swing-crop'] = profile('Keep the hitter, bat and ball in the crop',
    tile((302,87,458,514),(20,80,760,445)),
    tile((17,748,507,58),(790,95,465,150)),
    tile((539,748,506,58),(790,290,465,150)),
    tile((931,823,101,23),(450,540,400,100)))
P['saved-swing'] = profile('Replay or download the saved swing',
    tile((190,180,263,297),(20,88,790,410)),
    tile((0,552,327,42),(830,210,420,160)))
for name,title,box in [
    ('pitch-upload','Choose the original pitch video',(0,82,566,137)),
    ('pitch-people','Select the team and pitcher',(0,82,566,199)),
    ('pitch-clip-start','Set the beginning of the pitch clip',(0,82,566,173)),
]:
    P[name] = profile(title,tile(box,(20,100,1240,520)))
P['pitch-contact'] = profile('Mark when the pitch reaches home plate',
    tile((454,119,373,420),(20,80,1240,365)),
    tile((482,599,100,41),(20,490,270,120)),
    tile((699,599,99,41),(310,490,270,120)),
    tile((1118,649,146,45),(650,485,590,135)))
P['pitch-crop'] = profile('Keep the pitch action inside the crop',
    tile((476,119,330,326),(20,83,800,400)),
    tile((16,589,620,54),(835,145,420,180)),
    tile((1154,664,94,21),(485,535,420,100)))
P['pitch-speed'] = profile('Use the actual rubber-to-home distance',
    tile((39,173,620,59),(25,110,1230,180)),
    tile((1098,173,143,59),(25,350,600,235)),
    tile((40,254,150,33),(675,405,560,125)))
P['pitch-release'] = profile('Find the transition from hand to released ball',
    tile((286,220,142,145),(35,90,550,360)),
    tile((711,220,142,145),(690,90,550,360)),
    tile((588,304,104,88),(482,160,315,260)),
    tile((1037,648,207,46),(730,505,510,113)),
    tile((558,607,194,25),(25,522,640,90)))
P['pitch-review'] = profile('Review the pitch speed, then save',
    tile((38,172,391,62),(25,95,1230,190)),
    tile((39,334,230,60),(25,310,1230,180)),
    tile((286,253,149,33),(400,520,510,112)))
P['pitch-saved'] = profile('Find the saved pitch in the library',
    tile((804,190,385,136),(20,90,1240,390)),
    tile((1205,193,60,78),(440,500,400,130)))
P['pitch-playback'] = profile('Replay or download the saved pitch',
    tile((29,159,425,413),(20,85,805,430)),
    tile((0,653,327,42),(850,220,400,150)),
    tile((0,89,285,50),(30,535,1220,95)))
for name,title in [('matchup-pitch','Choose the pitch the hitter will face'),('matchup-swing','Choose the hitter and saved swing')]:
    P[name] = profile(title,
        tile((81,136,526,143),(25,92,1230,370)),
        tile((898,314,84,35),(465,500,350,145)))
P['matchup-review'] = profile('Check the two clips, then create the matchup',
    tile((82,136,529,157),(20,90,1240,365)),
    tile((856,414,126,34),(410,505,460,125)))
P['matchup-playback'] = profile('Play the matchup and review timing',
    tile((0,53,302,20),(25,78,1230,90)),
    tile((25,260,760,190),(20,190,1240,310)),
    tile((829,86,234,106),(25,520,750,110)),
    tile((830,210,218,20),(815,535,430,70)))
P['matchup-timing-frames'] = profile('Compare start and decision frames',
    tile((291,348,217,367),(20,82,600,480)),
    tile((788,348,218,367),(660,82,600,480)),
    tile((200,722,228,28),(70,580,500,55)),
    tile((682,722,232,28),(715,580,500,55)))
P['dashboard'] = profile('Review timing with the video limits in mind',
    tile((168,500,140,79),(20,100,600,235)),
    tile((316,641,139,105),(660,100,600,235)),
    tile((23,642,140,103),(20,370,600,240)),
    tile((169,642,139,103),(660,370,600,240)))


P['estimate'] = profile('Review the saved exit velocity, distance and launch angle',
    tile((377,94,416,28),(20,90,1240,135)),
    tile((661,240,337,189),(20,235,1240,300)),
    tile((0,499,130,33),(440,546,400,100)))
P['video-ready'] = profile('Play or download the finished EV video', *P['estimate']['tiles'])


def font(size):
    return ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', size)


def build_frame(name, spec, screens, output):
    source_name = 'map-landing.png' if name == 'map-landing-certainty' else name + '.png'
    if name == 'save-hit-control':
        source_name = '../../gameframe-20261106/screens/estimate.png'
    if name == 'home-saved-videos':
        source_name = 'home.png'
    main_source = screens / source_name
    if not main_source.exists():
        return None, [source_name]
    image = Image.new('RGB', SIZE, BG)
    draw = ImageDraw.Draw(image)
    title_font = font(48)
    title = spec['title']
    while draw.textbbox((0, 0), title, font=title_font)[2] > 1230:
        title_font = font(title_font.size - 1)
    draw.text((24, 13), title, fill=INK, font=title_font)
    records, missing = [], []
    for item in spec['tiles']:
        source = screens / item.get('source', source_name)
        if not source.exists():
            missing.append(source.name)
            continue
        with Image.open(source) as original:
            original = original.convert('RGB')
            x, y, w, h = item['crop']
            if min(x, y) < 0 or x+w > original.width or y+h > original.height:
                raise ValueError(f'{name}: crop {item["crop"]} exceeds {source.name} {original.size}')
            tx, ty, tw, th = item['target']
            cropped = original.crop((x, y, x+w, y+h))
            fitted = ImageOps.contain(cropped, (tw, th), Image.Resampling.LANCZOS)
            ox, oy = tx+(tw-fitted.width)//2, ty+(th-fitted.height)//2
            image.paste(fitted, (ox, oy))
            records.append({'source':str(source.resolve()), 'source_size':list(original.size),
                            'crop_xywh':item['crop'], 'placement_xywh':[ox,oy,fitted.width,fitted.height]})
    if missing:
        return None, missing
    destination = output / (name + '.png')
    image.save(destination)
    preview = output / (name + '-390.png')
    image.resize((390, round(SIZE[1]*390/SIZE[0])), Image.Resampling.LANCZOS).save(preview)
    return {'file':str(destination.resolve()), 'preview_390':str(preview.resolve()),
            'size':list(SIZE), 'source':str(main_source.resolve()),
            'source_sha256':hashlib.sha256(main_source.read_bytes()).hexdigest(),
            'title':title, 'crops':records, 'kind':'actual_ui_crop_composite'}, []


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder', type=Path, default=DEFAULT)
    args = parser.parse_args()
    screens = args.folder / 'screens'
    output = args.folder / 'phone-frames'
    output.mkdir(parents=True, exist_ok=True)
    records, missing = {}, []
    for name, spec in P.items():
        frame, absent = build_frame(name, spec, screens, output)
        if frame:
            records[name] = frame
        missing.extend(absent)
    known = {p.name for p in screens.glob('*.png')}
    covered = {Path(entry['source']).name for entry in records.values()}
    report = {'output_size':list(SIZE), 'preview_width':390,
              'note':'All UI regions are crops of real screenshots. Only section headings are added. Original captures are untouched.',
              'frames':records, 'missing':sorted(set(missing)), 'unprofiled':sorted(known-covered)}
    (output/'manifest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'generated':len(records),'missing':report['missing'],'unprofiled':report['unprofiled'],'manifest':str((output/'manifest.json').resolve())}, indent=2))


if __name__ == '__main__':
    main()
