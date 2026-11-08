"""Read-only, short-batch image tracker. No EV model, saved fit, or database inputs."""
import argparse,json,math,sys
from pathlib import Path
import cv2
import numpy as np

cv2.setNumThreads(2)

def camera_motion(previous,current):
    """Estimate background motion independently of the clicked ball positions."""
    h,w=previous.shape;scale=min(1.,640/w)
    a=cv2.resize(previous,None,fx=scale,fy=scale);b=cv2.resize(current,None,fx=scale,fy=scale)
    mask=np.zeros(a.shape,np.uint8);mask[int(a.shape[0]*.28):int(a.shape[0]*.88),:]=255
    points=cv2.goodFeaturesToTrack(a,350,.015,8,mask=mask)
    if points is None or len(points)<12:return np.eye(2,3,dtype=np.float32),False
    moved,status,_=cv2.calcOpticalFlowPyrLK(a,b,points,None,winSize=(21,21),maxLevel=3)
    if moved is None:return np.eye(2,3,dtype=np.float32),False
    keep=status.ravel()==1
    if keep.sum()<12:return np.eye(2,3,dtype=np.float32),False
    matrix,inliers=cv2.estimateAffinePartial2D(points[keep],moved[keep],method=cv2.RANSAC,ransacReprojThreshold=2.5)
    if matrix is None or inliers.sum()<10:return np.eye(2,3,dtype=np.float32),False
    size=math.hypot(matrix[0,0],matrix[1,0]);rotation=abs(math.atan2(matrix[1,0],matrix[0,0]))
    if not .93<size<1.07 or rotation>.08:return np.eye(2,3,dtype=np.float32),False
    matrix[:,2]/=scale
    return matrix.astype(np.float32),True

def move(matrix,point):return matrix[:,:2]@np.asarray(point,dtype=float)+matrix[:,2]
def patch(image,point,radius=7):
    x,y=map(float,point)
    if x<radius or y<radius or x>=image.shape[1]-radius or y>=image.shape[0]-radius:return None
    return cv2.getRectSubPix(image,(2*radius+1,2*radius+1),(x,y))

def locate(previous,current,point,velocity,template,matrix,uncertain_velocity=False):
    h,w=current.shape;radius=7
    origin=move(matrix,point);predicted=origin+matrix[:,:2]@velocity
    search=44 if uncertain_velocity else max(20,min(44,12+np.linalg.norm(velocity)*.8))
    if predicted[0]<0 or predicted[1]<0 or predicted[0]>=w or predicted[1]>=h:
        return None,{'reason':'predicted_out_of_view','predicted':predicted.tolist()}
    x0=max(radius,int(predicted[0]-search));x1=min(w-radius,int(predicted[0]+search)+1)
    y0=max(radius,int(predicted[1]-search));y1=min(h-radius,int(predicted[1]+search)+1)
    if x1<=x0 or y1<=y0:return None,{'reason':'near_frame_edge','predicted':predicted.tolist()}
    crop=current[y0-radius:y1+radius,x0-radius:x1+radius]
    raw_template=template['raw'] if isinstance(template,dict) else template
    motion_template=template['motion'] if isinstance(template,dict) else np.abs(template.astype(np.float32)-cv2.GaussianBlur(template,(0,0),3).astype(np.float32))
    corr=cv2.matchTemplate(crop,raw_template,cv2.TM_CCOEFF_NORMED)
    # The same ball can appear dark against sky and bright against trees.
    warped=cv2.warpAffine(previous,matrix,(w,h),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT)
    signed=current.astype(np.float32)-warped.astype(np.float32)
    change=np.abs(signed)
    motion_crop=change[y0-radius:y1+radius,x0-radius:x1+radius]
    motion_corr=cv2.matchTemplate(motion_crop,motion_template.astype(np.float32),cv2.TM_CCOEFF_NORMED)
    motion=cv2.GaussianBlur(change,(3,3),0)[y0:y1,x0:x1]
    local_contrast=current.astype(np.float32)-cv2.GaussianBlur(current,(0,0),3).astype(np.float32)
    contrast=np.abs(local_contrast)[y0:y1,x0:x1]
    signed_motion=cv2.GaussianBlur(signed,(3,3),0)[y0:y1,x0:x1]
    yy,xx=np.mgrid[y0:y1,x0:x1];distance=np.hypot(xx-predicted[0],yy-predicted[1])
    score=.55*np.maximum(motion_corr,0)+.20*np.maximum(corr,0)+.15*np.clip(motion/18,0,1)+.10*np.clip(contrast/18,0,1)-.08*np.minimum(distance/search,1)
    # A disappearance residual alone is not an object still present in this frame.
    present=(local_contrast[y0:y1,x0:x1]*signed_motion>0)&(contrast>=.18*motion)
    eligible=present&(motion>=1.7)&(contrast>=2)&(motion_corr>=.35)&((corr>=.12)|(motion_corr>=.65))
    score[~eligible]=-1
    _,value,_,where=cv2.minMaxLoc(score);cx,cy=where
    found=np.array([x0+cx,y0+cy],float)
    suppressed=score.copy();cv2.circle(suppressed,(cx,cy),5,-1,-1);runner=float(suppressed.max())
    diagnostics={'appearance':float(corr[cy,cx]),'motion_appearance':float(motion_corr[cy,cx]),'motion':float(motion[cy,cx]),'contrast':float(contrast[cy,cx]),'separation':float(value-runner),'search_distance':float(distance[cy,cx]),'score':float(value),'predicted':predicted.tolist(),'candidate':found.tolist()}
    if motion_corr[cy,cx]<.35 or (corr[cy,cx]<.12 and motion_corr[cy,cx]<.65) or contrast[cy,cx]<2 or motion[cy,cx]<1.7 or value<.38:
        return None,{**diagnostics,'reason':'weak_image_evidence'}
    if value-runner<.012:return None,{**diagnostics,'reason':'competing_candidates'}
    # Check for a change at the old, camera-registered ball location as well.
    # Raw patch matching backward can instead lock onto leaves around a tiny ball.
    ox,oy=map(lambda x:int(round(x)),origin)
    old=change[max(0,oy-4):min(h,oy+5),max(0,ox-4):min(w,ox+5)]
    old_support=float(old.max()) if old.size else 0
    diagnostics['old_position_motion']=old_support
    if old_support<2:return None,{**diagnostics,'reason':'motion_pair_not_supported'}
    return found,diagnostics

def track(config):
    cv2.setRNGSeed(0)
    folder=Path(config['frames_dir']);files=sorted(folder.glob('frame-*.jpg'))
    if not files:raise ValueError('No extracted frames.')
    fps=float(config['fps']);anchors=sorted(config['anchors'],key=lambda a:a['frame'])
    if not anchors:raise ValueError('Mark a visible ball before suggesting points.')
    last=anchors[-1];index=int(last['frame']);image=cv2.imread(str(files[index]),cv2.IMREAD_GRAYSCALE)
    if image is None:raise ValueError('Cannot read anchor frame.')
    h,w=image.shape;point=np.array([float(last['x']),float(last['y'])]);template=patch(image,point)
    if template is None:return {'points':[],'stopped':{'frame':index,'reason':'anchor_near_frame_edge'},'method':'image_assist_lab_v1'}
    if float(template.std())<1:return {'points':[],'stopped':{'frame':index,'reason':'anchor_has_little_visual_detail'},'method':'image_assist_lab_v1'}
    raw_template=template
    if index>0:
        before=cv2.imread(str(files[index-1]),cv2.IMREAD_GRAYSCALE)
        matrix,_=camera_motion(before,image)
        registered=cv2.warpAffine(before,matrix,(w,h),borderMode=cv2.BORDER_REFLECT)
        residual=np.abs(image.astype(np.float32)-registered.astype(np.float32))
        motion_template=patch(residual,point)
    else:motion_template=np.abs(template.astype(np.float32)-cv2.GaussianBlur(template,(0,0),3).astype(np.float32))
    if motion_template is None or float(motion_template.std())<1:return {'points':[],'stopped':{'frame':index,'reason':'anchor_has_little_motion_evidence'},'method':'image_assist_lab_v2'}
    template={'raw':raw_template,'motion':motion_template}
    velocity=np.zeros(2);uncertain=True
    if len(anchors)>1:
        a=anchors[-2];delta=index-int(a['frame'])
        if 0<delta<=max(12,round(fps*.4)):
            velocity=(point-np.array([a['x'],a['y']]))/delta;uncertain=False
    points=[];stop=None;last_index=min(len(files)-1,index+int(config.get('max_steps',round(fps*.8))))
    for frame in range(index+1,last_index+1):
        current=cv2.imread(str(files[frame]),cv2.IMREAD_GRAYSCALE)
        if current is None:raise ValueError('Cannot read frame '+str(frame))
        matrix,registered=camera_motion(image,current)
        if not registered and np.linalg.norm(velocity)>35:
            stop={'frame':frame,'reason':'camera_motion_not_resolved'};break
        found,diagnostic=locate(image,current,point,velocity,template,matrix,uncertain)
        if found is None:
            stop={'frame':frame,**diagnostic};break
        new_velocity=found-move(matrix,point)
        velocity=new_velocity if uncertain else .55*new_velocity+.45*(matrix[:,:2]@velocity)
        # Keep the clicked appearance fixed to resist drifting onto another object.
        point=found;image=current;uncertain=False
        points.append({'frame':frame,'x':round(float(point[0]),3),'y':round(float(point[1]),3),'status':'unreviewed','background_registered':registered,'evidence':diagnostic})
    return {'points':points,'stopped':stop,'method':'image_assist_lab_v3','uses_ev_prediction':False,'automatic_acceptance':False,'frames_examined':len(points)+(1 if stop else 0)}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--input',type=Path);parser.add_argument('--output',type=Path);parser.add_argument('--worker',action='store_true');parser.add_argument('--mode',choices=['batch','contact'],default='batch');args=parser.parse_args()
    if args.worker:
        print(json.dumps({'ready':True}),flush=True)
        for line in sys.stdin:
            request={}
            try:
                request=json.loads(line);config=json.loads(Path(request['input']).read_text(encoding='utf-8'))
                if request.get('mode')=='contact':
                    import importlib,contact_scan
                    importlib.reload(contact_scan)
                    if config.get('video_path'):
                        from stream_scan import scan_video
                        result=scan_video(config,lambda value:print(json.dumps({'id':request['id'],'progress':value}),flush=True))
                    else:result=contact_scan.scan(config,lambda value:print(json.dumps({'id':request['id'],'progress':value}),flush=True))
                else:result=track(config)
                Path(request['output']).write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps({'id':request['id'],'ok':True}),flush=True)
            except Exception as error:print(json.dumps({'id':request.get('id'),'error':str(error)}),flush=True)
    else:
        if not args.input or not args.output:parser.error('--input and --output are required')
        config=json.loads(args.input.read_text(encoding='utf-8'))
        if args.mode=='contact':
            import contact_scan
            result=contact_scan.scan(config,lambda value:print(json.dumps({'progress':value}),flush=True))
        else:result=track(config)
        args.output.write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps({'suggested':len(result['points']),'stopped':(result.get('stopped') or {}).get('reason')}),flush=True)
