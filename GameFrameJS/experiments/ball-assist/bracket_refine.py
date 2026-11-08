from frame_source import read_frame
"""Refine short weak intervals between fresh, image-supported detections.

The line and elapsed distance define a search region, never an observation.
No saved measurements, manual endpoints, EV fits, or landing estimates enter here.
"""
from functools import lru_cache
import cv2,numpy as np

def bracket_geometry(a,b,point,fraction):
    delta=np.asarray(b,float)-a;length=float(np.linalg.norm(delta))
    if length<2:return None
    relative=np.asarray(point,float)-a;along=float(relative@delta/(length*length))
    perpendicular=abs(float(relative[0]*delta[1]-relative[1]*delta[0]))/length
    radius=max(3.5,length*.035);travel_margin=.2+min(.1,6/length)
    if perpendicular>radius or abs(along-fraction)>travel_margin or along<-.05 or along>1.05:return None
    return perpendicular/radius+abs(along-fraction)/travel_margin

def refine_between_detections(files,points,cameras,fps,checked,frame_times=None):
    from contact_scan import candidates
    if len(points)<5:return points,{'trusted_anchor_frames':[],'refined_frames':[],'rejected_frames':[],'extra_frames_checked':[]}
    original=sorted(points,key=lambda p:p['frame']);by_frame={p['frame']:p for p in original};times=frame_times if frame_times is not None and len(frame_times)==len(files) else np.arange(len(files))/fps
    @lru_cache(maxsize=10)
    def gray(frame):return read_frame(files[frame],cv2.IMREAD_GRAYSCALE)
    @lru_cache(maxsize=128)
    def inverse(frame):return np.linalg.inv(cameras[frame])
    def transform(source,target):return (cameras[target]@inverse(source))[:2].astype(np.float32)
    radius=5;yy,xx=np.mgrid[-radius:radius+1,-radius:radius+1];window=np.exp(-(xx*xx+yy*yy)/18)
    @lru_cache(maxsize=128)
    def appearance(frame,x,y):
        image=gray(frame)
        if image is None:return None,0
        patch=cv2.getRectSubPix(image,(11,11),(float(x),float(y))).astype(np.float32);changes=[];signed=[]
        for neighbor in (frame-1,frame+1):
            if neighbor not in cameras or not 0<=neighbor<len(files):continue
            matrix=transform(neighbor,frame);matrix[:,2]-=(x-radius,y-radius)
            background=cv2.warpAffine(gray(neighbor),matrix,(11,11),borderMode=cv2.BORDER_REFLECT).astype(np.float32);difference=patch-background;changes.append(np.abs(difference));signed.append(difference)
        if not changes:return None,0
        signal=np.minimum.reduce(changes)
        if len(signed)==2:signal[signed[0]*signed[1]<=0]=0
        energy=float(signal[3:8,3:8].max());weighted=signal*window;weighted-=weighted.mean();norm=float(np.linalg.norm(weighted))
        return (weighted.ravel()/norm,energy) if norm>1 else (None,energy)
    def similar(a,b):return float(a@b) if a is not None and b is not None else -1
    def supported(p):return p.get('net_clear',True) or p.get('image_supported',False)
    anchors=[]
    for i,p in enumerate(original[1:-1],1):
        before,after=original[i-1],original[i+1]
        if p.get('evidence',0)<.7 or not supported(p) or before['segment']!=p['segment'] or after['segment']!=p['segment']:continue
        if times[after['frame']]-times[before['frame']]>.25:continue
        a=np.array([before['stabilized_x'],before['stabilized_y']]);b=np.array([after['stabilized_x'],after['stabilized_y']]);xy=np.array([p['stabilized_x'],p['stabilized_y']]);fraction=(times[p['frame']]-times[before['frame']])/(times[after['frame']]-times[before['frame']])
        if bracket_geometry(a,b,xy,fraction) is None:continue
        vector,energy=appearance(p['frame'],p['x'],p['y']);left,_=appearance(before['frame'],before['x'],before['y']);right,_=appearance(after['frame'],after['x'],after['y'])
        if energy>=2 and min(similar(vector,left),similar(vector,right))>=.45:anchors.append(p)
    refined=[];rejected=[];inspected=[];checked=set(checked)
    # Only original forward-pass observations become anchors. New matches never
    # bootstrap additional matches in this pass.
    for left,right in zip(anchors,anchors[1:]):
        first,last=left['frame'],right['frame']
        if left['segment']!=right['segment'] or last-first<2 or times[last]-times[first]>.25:continue
        a=np.array([left['stabilized_x'],left['stabilized_y']]);b=np.array([right['stabilized_x'],right['stabilized_y']]);delta=b-a;distance=float(np.linalg.norm(delta))
        if distance<2:continue
        direction=delta/distance;normal=np.array([-direction[1],direction[0]]);left_vector,left_energy=appearance(first,left['x'],left['y']);right_vector,right_energy=appearance(last,right['x'],right['y'])
        for frame in range(first+1,last):
            existing=by_frame.get(frame)
            if frame not in checked or (existing and existing.get('evidence',0)>=.7 and supported(existing)):continue
            fraction=float((times[frame]-times[first])/(times[last]-times[first]));center=a+delta*fraction;along=distance*.3+6;across=max(3.5,distance*.035)+4
            corners=[(cameras[frame]@np.r_[center+direction*du+normal*dv,1])[:2] for du in (-along,along) for dv in (-across,across)]
            corners=np.array(corners);roi=(corners[:,0].min(),corners[:,1].min(),corners[:,0].max()+1,corners[:,1].max()+1)
            current=gray(frame);future=gray(frame+1) if frame+1<len(files) else None
            found=candidates(gray(frame-1),current,transform(frame-1,frame),roi,coverage=True,sensitive=True,next_frame=future,next_matrix=transform(frame,frame+1) if frame+1 in cameras else None);inspected.append(frame)
            matches=[]
            for point in found:
                stable=(inverse(frame)@np.array([point['x'],point['y'],1]))[:2];geometry=bracket_geometry(a,b,stable,fraction)
                if geometry is None:continue
                vector,energy=appearance(frame,round(point['x'],3),round(point['y'],3));match=min(similar(vector,left_vector),similar(vector,right_vector))
                if match<.55 or energy<max(2,min(left_energy,right_energy)*.2):continue
                matches.append((match-.12*geometry,point,stable,match))
            matches.sort(key=lambda item:item[0],reverse=True)
            if matches and (len(matches)==1 or matches[0][0]-matches[1][0]>.035):
                _,point,stable,match=matches[0];by_frame[frame]={'frame':frame,'x':round(point['x'],3),'y':round(point['y'],3),'stabilized_x':round(float(stable[0]),3),'stabilized_y':round(float(stable[1]),3),'status':'unreviewed','segment':left['segment'],'evidence':round(point['quality'],3),'net_clear':False,'image_supported':True,'refined_from_images':True,'bracket_frames':[first,last],'appearance_agreement':round(match,3)};refined.append(frame)
            elif existing:
                stable=np.array([existing['stabilized_x'],existing['stabilized_y']])
                if bracket_geometry(a,b,stable,fraction) is None:del by_frame[frame];rejected.append(frame)
    return [by_frame[f] for f in sorted(by_frame)],{'trusted_anchor_frames':[p['frame'] for p in anchors],'refined_frames':sorted(set(refined)),'rejected_frames':sorted(set(rejected)),'extra_frames_checked':sorted(set(inspected))}
