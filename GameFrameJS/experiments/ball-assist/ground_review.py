from frame_source import read_frame
"""Suggest image-supported bounce events only. Never extrapolate an impact."""
import cv2,numpy as np

def field_mask(image):
    h,w=image.shape[:2];small=cv2.resize(image,(320,max(1,round(h*320/w))));hsv=cv2.cvtColor(small,cv2.COLOR_BGR2HSV)
    hue,saturation,value=cv2.split(hsv)
    grass=(hue>=25)&(hue<=100)&(saturation>45)&(value>30)
    dirt=((hue<23)|(hue>165))&(saturation>65)&(value>40)
    mask=cv2.morphologyEx(((grass|dirt)*255).astype(np.uint8),cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
    mask=cv2.morphologyEx(mask,cv2.MORPH_OPEN,np.ones((3,3),np.uint8))
    count,labels,stats,_=cv2.connectedComponentsWithStats(mask)
    ground=np.zeros(mask.shape,np.uint8)
    fallback=[]
    for label in range(1,count):
        x,y,width,height,area=stats[label]
        region=labels==label;grass_pixels=region&grass;green_count=np.count_nonzero(grass_pixels)
        if area>mask.size*.025 and green_count>mask.size*.01 and y+height>=mask.shape[0]-2:ground[region]=255
        elif green_count>mask.size*.025 and width>mask.shape[1]*.25:
            mean_y=float(np.nonzero(grass_pixels)[0].mean())/mask.shape[0]
            if mean_y>.4:fallback.append((green_count*mean_y**2,label))
    if not np.any(ground) and fallback:ground[labels==max(fallback)[1]]=255
    return ground

def on_field(image,point):
    mask=field_mask(image);x,y=point;scale=mask.shape[1]/image.shape[1];x=round(x*scale);y=round(y*scale)
    if x<0 or y<0 or x>=mask.shape[1] or y>=mask.shape[0]:return False
    neighborhood=mask[max(0,y-3):y+4,max(0,x-3):x+4]
    return bool(np.count_nonzero(neighborhood)>=neighborhood.size*.6)

def review_ground(files,points,cameras,fps):
    if len(points)<8:return None
    # A reversal after descent can indicate a bounce. Camera motion is removed
    # using background registration, independently of EV/distance estimates.
    for i in range(4,len(points)-4):
        before=points[i-3:i+1];after=points[i:i+4]
        if min(sum(p.get('image_supported',p.get('net_clear',True)) for p in group) for group in (before,after))<3:continue
        if any(p['segment']!=before[0]['segment'] for p in before+after):continue
        if after[-1]['frame']-before[0]['frame']>fps*.55:continue
        pre=np.polyfit([p['frame'] for p in before],[p['stabilized_y'] for p in before],1)[0]
        post=np.polyfit([p['frame'] for p in after],[p['stabilized_y'] for p in after],1)[0]
        if pre<.8 or post>-.5:continue
        peak=max(before+after,key=lambda p:p['stabilized_y']);image=read_frame(files[peak['frame']])
        if image is None or not on_field(image,(peak['x'],peak['y'])):continue
        return {'kind':'bounce_candidate','frame':peak['frame'],'start':max(0,peak['frame']-3),'end':min(len(files)-1,peak['frame']+3),'image_x':peak['x'],'image_y':peak['y'],'observed_ground_contact':False,'requires_confirmation':True,'basis':'Observed descending and rising points near the visible field; review the possible bounce.'}
    return None
