from frame_source import read_frame
"""Contact-only full-clip proposal detector. No EV model or later manual seeds."""
import math
from pathlib import Path
import cv2
import numpy as np

cv2.setNumThreads(2)

def move(matrix,xy):return matrix[:,:2]@np.asarray(xy,dtype=float)+matrix[:,2]

def shifted_samples(samples,matrix):return [(frame,move(matrix,xy)) for frame,xy in samples]

def coast(track,matrix):
    return {**track,'pos':move(matrix,track['pos']),'start':move(matrix,track['start']),'velocity':matrix[:,:2]@track['velocity'],'acceleration':matrix[:,:2]@track.get('acceleration',np.zeros(2)),'samples':shifted_samples(track.get('samples',[]),matrix),'miss':track['miss']+1}

def smooth_active(track):
    """Fit recent image observations, not a physical/EV trajectory or future labels."""
    samples=track.get('samples',[])[-10:]
    if len(samples)<5:return track
    times=np.array([f-samples[-1][0] for f,xy in samples],float);positions=np.array([xy for f,xy in samples])
    design=np.column_stack([np.ones(len(times)),times,times**2]);weights=np.ones(len(times))
    for _ in range(2):
        fitted=np.linalg.lstsq(design*weights[:,None],positions*weights[:,None],rcond=None)[0]
        residual=np.linalg.norm(design@fitted-positions,axis=1);weights=np.minimum(1,2/np.maximum(residual,.01))
    acceleration=2*fitted[2]
    if np.linalg.norm(acceleration)>14:return track
    return {**track,'pos':fitted[0],'velocity':fitted[1]-acceleration/2,'acceleration':acceleration}

def background_motion(a,b):
    h,w=a.shape;scale=min(1.,400/w)
    aa=cv2.resize(a,None,fx=scale,fy=scale);bb=cv2.resize(b,None,fx=scale,fy=scale)
    top=int(aa.shape[0]*.3);bottom=int(aa.shape[0]*.88)
    aa=aa[top:bottom].astype(np.float32);bb=bb[top:bottom].astype(np.float32)
    shifts=[]
    # Separate background tiles prevent one moving ball/player from defining camera motion.
    for row in range(2):
        for column in range(2):
            y0=row*aa.shape[0]//2;y1=(row+1)*aa.shape[0]//2;x0=column*aa.shape[1]//2;x1=(column+1)*aa.shape[1]//2
            first=aa[y0:y1,x0:x1].copy();second=bb[y0:y1,x0:x1].copy()
            window=cv2.createHanningWindow((first.shape[1],first.shape[0]),cv2.CV_32F)
            shift,response=cv2.phaseCorrelate(first,second,window)
            if response>.18 and abs(shift[0])<30 and abs(shift[1])<25:shifts.append(shift)
    if len(shifts)>=3:
        shift=np.median(shifts,axis=0);agreement=np.linalg.norm(np.asarray(shifts)-shift,axis=1)<1
        if agreement.sum()>=max(2,math.ceil(len(shifts)*.6)):
            return np.float32([[1,0,shift[0]/scale],[0,1,shift[1]/scale]]),True
    # Low-detail or zoomed backgrounds need a geometric fallback.
    from tracker import camera_motion
    return camera_motion(a,b)

def detect_net_orientations(image):
    """Require repeated strands in two directions, rather than treating a ball streak as a line."""
    h,w=image.shape;scale=min(1.,960/w);small=cv2.resize(image,None,fx=scale,fy=scale)
    lines=cv2.HoughLinesP(cv2.Canny(small,35,100),1,np.pi/180,55,minLineLength=max(40,round(small.shape[1]*.12)),maxLineGap=12)
    if lines is None:return None
    lines=lines.reshape(-1,4).astype(float)/scale;delta=lines[:,2:]-lines[:,:2];length=np.linalg.norm(delta,axis=1);angles=np.mod(np.arctan2(delta[:,1],delta[:,0]),np.pi)
    histogram,bins=np.histogram(angles,bins=36,range=(0,np.pi),weights=length);first=(bins[np.argmax(histogram)]+bins[np.argmax(histogram)+1])/2
    difference=np.minimum(np.abs(angles-first),np.pi-np.abs(angles-first));other=(difference>np.pi/3)&(difference<2*np.pi/3)
    if not np.any(other):return None
    second_hist,_=np.histogram(angles[other],bins=bins,weights=length[other]);k=int(np.argmax(second_hist));second=(bins[k]+bins[k+1])/2
    for angle in (first,second):
        diff=np.minimum(np.abs(angles-angle),np.pi-np.abs(angles-angle));family=lines[diff<np.pi/12]
        if len(family)<5:return None
        middle=(family[:,:2]+family[:,2:])/2;normal=np.array([-np.sin(angle),np.cos(angle)]);offsets=np.sort(middle@normal)
        unique=1+int(np.count_nonzero(np.diff(offsets)>max(4,w*.004)))
        if unique<5 or offsets[-1]-offsets[0]<min(h,w)*.3:return None
    return (first,second)

def reject_line_features(image,points,orientations=None):
    """Reject repeated net/line texture; retain independent ball contrast."""
    if not points:return points
    orientations=orientations if orientations is not None else detect_net_orientations(image)
    if orientations is None:return points
    h,w=image.shape;xy=np.array([[p['x'],p['y']] for p in points]);x0=max(0,int(xy[:,0].min())-40);x1=min(w,int(xy[:,0].max())+41);y0=max(0,int(xy[:,1].min())-40);y1=min(h,int(xy[:,1].max())+41)
    crop=image[y0:y1,x0:x1];scale=min(1.,960/max(crop.shape));small=cv2.resize(crop,None,fx=scale,fy=scale)
    edges=cv2.Canny(small,35,100);length=max(32,min(120,round(min(small.shape)*.45)))
    lines=cv2.HoughLinesP(edges,1,np.pi/180,45,minLineLength=length,maxLineGap=12)
    if lines is None:return points
    lines=lines.reshape(-1,4).astype(float)/scale;lines[:,[0,2]]+=x0;lines[:,[1,3]]+=y0
    angles=np.mod(np.arctan2(lines[:,3]-lines[:,1],lines[:,2]-lines[:,0]),np.pi);selected=np.zeros(len(lines),bool)
    for angle in orientations:
        difference=np.minimum(np.abs(angles-angle),np.pi-np.abs(angles-angle));selected|=difference<np.pi/9
    lines=lines[selected]
    if not len(lines):return points
    starts=lines[:,:2];deltas=lines[:,2:]-starts;lengths=np.linalg.norm(deltas,axis=1);directions=deltas/np.maximum(lengths[:,None],1)
    offsets=xy[:,None,:]-starts;along=(offsets*directions).sum(axis=2);distance=np.abs(offsets[:,:,0]*directions[:,1]-offsets[:,:,1]*directions[:,0]);distance[(along<-3)|(along>lengths+3)]=1e9
    closest=np.argmin(distance,axis=1);near=distance[np.arange(len(points)),closest]<=4
    # Check independent contrast throughout the caution band, including points
    # 4-8 pixels from a strand. Those points were kept but incorrectly marked
    # unsupported, causing a real ball to be dropped after repeated crossings.
    indices=np.flatnonzero(distance[np.arange(len(points)),closest]<=8)
    for i,point in enumerate(points):point['net_clear']=bool(distance[i,closest[i]]>8);point['image_supported']=point['net_clear']
    keep=~near
    if not len(indices):return points
    samples=xy[indices,None,:]+np.r_[-28:-7:4,8:29:4][None,:,None]*directions[closest[indices],None,:];samples=np.rint(samples).astype(int)
    valid=(samples[:,:,0]>=0)&(samples[:,:,0]<w)&(samples[:,:,1]>=0)&(samples[:,:,1]<h);sx=np.clip(samples[:,:,0],0,w-1);sy=np.clip(samples[:,:,1],0,h-1)
    values=image[sy,sx].astype(float);values[~valid]=np.nan;levels=np.nanmedian(values,axis=1)
    centers=np.rint(xy[indices]).astype(int);cx=np.clip(centers[:,0],0,w-1);cy=np.clip(centers[:,1],0,h-1);blur=cv2.blur(image,(3,3))
    brightness=.5*image[cy,cx].astype(float)+.5*blur[cy,cx].astype(float)
    thresholds=np.maximum(25,np.array([points[i]['contrast'] for i in indices])*.2)
    line_mask=np.zeros(image.shape,np.uint8)
    for line in lines:cv2.line(line_mask,tuple(np.rint(line[:2]).astype(int)),tuple(np.rint(line[2:]).astype(int)),255,6)
    dy,dx=np.mgrid[-12:13,-12:13];px=centers[:,0,None]+dx.ravel();py=centers[:,1,None]+dy.ravel();inside=(px>=0)&(px<w)&(py>=0)&(py<h);px=np.clip(px,0,w-1);py=np.clip(py,0,h-1)
    patches=image[py,px].astype(float);free=inside&(line_mask[py,px]==0);background_samples=np.where(free,patches,np.nan);empty=~free.any(axis=1);background_samples[empty,0]=brightness[empty]
    background=np.nanmedian(background_samples,axis=1);polarity=np.sign(brightness-background);foreground_threshold=np.maximum(20,np.array([points[i]['contrast'] for i in indices])*.3)
    independent=free&((patches-background[:,None])*polarity[:,None]>foreground_threshold[:,None])
    supported=((valid.sum(axis=1)<4)|((np.abs(brightness-levels)>thresholds)&(np.abs(brightness-background)>foreground_threshold)&(independent.sum(axis=1)>=3)))&(~empty)
    keep[indices]|=supported
    for index,accepted,support in zip(indices,supported,independent.sum(axis=1)):
        points[index]['image_supported']=bool(accepted);points[index]['independent_support']=int(support)
    return [p for p,accepted in zip(points,keep) if accepted]


def candidates(previous,current,matrix,roi=None,coverage=False,sensitive=False,next_frame=None,next_matrix=None):
    h,w=current.shape;x_offset=y_offset=0
    if roi is not None:
        x0,y0,x1,y1=roi;x_offset=max(0,int(x0));y_offset=max(0,int(y0));x1=min(w,int(x1));y1=min(h,int(y1))
        if x1<=x_offset or y1<=y_offset:return []
        current=current[y_offset:y1,x_offset:x1];matrix=matrix.copy();matrix[:,2]-=(x_offset,y_offset);h,w=current.shape
    warped=cv2.warpAffine(previous,matrix,(w,h),borderMode=cv2.BORDER_REFLECT)
    signed=current.astype(np.float32)-warped.astype(np.float32)
    change=np.abs(signed)
    if next_frame is not None and next_matrix is not None:
        future_matrix=cv2.invertAffineTransform(next_matrix);future_matrix[:,2]-=(x_offset,y_offset)
        future=cv2.warpAffine(next_frame,future_matrix,(w,h),borderMode=cv2.BORDER_REFLECT)
        signed_future=current.astype(np.float32)-future.astype(np.float32)
        change=np.minimum(change,np.abs(signed_future));change[signed*signed_future<=0]=0
        signed=(signed+signed_future)/2
    motion=cv2.GaussianBlur(change,(3,3),0)
    local=current.astype(np.float32)-cv2.GaussianBlur(current,(0,0),2).astype(np.float32)
    contrast=np.abs(local);polarity=cv2.GaussianBlur(signed,(3,3),0)
    mask=((motion>(1.2 if sensitive else 4))&(contrast>(1.8 if sensitive else 3))&(local*polarity>0)&(contrast>.2*motion)).astype(np.uint8)
    response=motion*np.minimum(contrast,80)*mask
    maxima=(response>=cv2.dilate(response,np.ones((9,9),np.uint8)))&(response>(10 if sensitive else 100))
    ys,xs=np.nonzero(maxima);output=[]
    if coverage and len(xs):
        # A small sky ball must not compete with every high-contrast uniform/grass
        # edge in the picture. Preserve local proposals throughout the image.
        tiles=(ys//64)*((w+63)//64)+xs//64
        order=np.lexsort((-response[ys,xs],tiles));ordered=tiles[order]
        starts=np.maximum.accumulate(np.where(np.r_[True,ordered[1:]!=ordered[:-1]],np.arange(len(order)),0))
        selected=order[np.arange(len(order))-starts<3];ys=ys[selected];xs=xs[selected]
    elif len(xs)>100:
        selected=np.argpartition(response[ys,xs],-100)[-100:];ys=ys[selected];xs=xs[selected]
    if len(xs):
        # Evaluate the same 9x9 centroid windows together. Per-proposal Python
        # loops were repeating thresholding, area, and moment calculations.
        offsets=np.arange(-4,5)
        yy=ys[:,None,None]+offsets[None,:,None]
        xx=xs[:,None,None]+offsets[None,None,:]
        valid=(yy>=0)&(yy<h)&(xx>=0)&(xx<w)
        cy=np.clip(yy,0,h-1);cx=np.clip(xx,0,w-1)
        signals=response[cy,cx].copy()
        signals[~valid]=0
        signals[local[cy,cx]*local[ys,xs,None,None]<=0]=0
        signals[signals<response[ys,xs,None,None]*.2]=0
        areas=np.count_nonzero(signals,axis=(1,2))
        weights=np.sum(signals,axis=(1,2),dtype=np.float64)
        keep=(areas>=1)&(areas<=70)&(weights>0)
        widths=np.minimum(w,xs+5)-np.maximum(0,xs-4)
        heights=np.minimum(h,ys+5)-np.maximum(0,ys-4)
        strengths=motion[ys,xs].astype(float);details=contrast[ys,xs].astype(float)
        qualities=.4*np.minimum(strengths/25,1)+.4*np.minimum(details/20,1)+.2*np.minimum(areas/(widths*heights)*3,1)
        keep&=qualities>=(.17 if sensitive else .5)
        safe_weights=np.where(weights>0,weights,1.)
        centers_x=np.sum(signals*xx,axis=(1,2),dtype=np.float64)/safe_weights+x_offset
        centers_y=np.sum(signals*yy,axis=(1,2),dtype=np.float64)/safe_weights+y_offset
        for index in np.flatnonzero(keep):
            output.append({'x':float(centers_x[index]),'y':float(centers_y[index]),'quality':float(qualities[index]),'area':int(areas[index]),'contrast':float(details[index])})
    output.sort(key=lambda p:p['quality'],reverse=True)
    unique=[];cells={}
    for point in output:
        cell=(int(point['x']//4),int(point['y']//4))
        neighbors=[p for dx in (-1,0,1) for dy in (-1,0,1) for p in cells.get((cell[0]+dx,cell[1]+dy),[])]
        if any((p['x']-point['x'])**2+(p['y']-point['y'])**2<16 for p in neighbors):continue
        unique.append(point);cells.setdefault(cell,[]).append(point)
    return unique if coverage else unique[:40]

def compact_ball_evidence(image,points):
    """Reject extended ridges/people texture instead of calling them a returning ball."""
    if not points:return []
    # Only the candidate patches consume this blurred image. Keep a halo
    # wider than the patch plus Gaussian kernel, preserving the full-image
    # border behavior and the original float32 interpolation coordinates.
    centers=np.asarray([[p['x'],p['y']] for p in points],dtype=np.float32).astype(float)
    h,w=image.shape
    x0=max(0,int(np.floor(centers[:,0].min()))-32);x1=min(w,int(np.ceil(centers[:,0].max()))+33)
    y0=max(0,int(np.floor(centers[:,1].min()))-32);y1=min(h,int(np.ceil(centers[:,1].max()))+33)
    crop=image[y0:y1,x0:x1]
    residual=crop.astype(np.float32)-cv2.GaussianBlur(crop,(0,0),3).astype(np.float32);kept=[]
    max_area=max(16,round(16*(w/640)**2))
    for point,center in zip(points,centers):
        patch=cv2.getRectSubPix(residual,(31,31),(float(center[0]-x0),float(center[1]-y0)))
        center=patch[12:19,12:19];y,x=np.unravel_index(np.argmax(np.abs(center)),center.shape);x+=12;y+=12;peak=float(patch[y,x])
        mask=(patch*(1 if peak>=0 else -1)>max(1.5,abs(peak)*.4)).astype(np.uint8)
        _,labels,stats,_=cv2.connectedComponentsWithStats(mask)
        label=labels[y,x]
        if not label:continue
        left,top,width,height,area=stats[label]
        if area>max_area or left==0 or top==0 or left+width>=31 or top+height>=31:continue
        kept.append(point)
    return kept

def confirmed_recovery_points(points,times,height,fps,protected_launch=None):
    """Keep searching, but don't export stationary scenery or one-off gap matches."""
    kept=[];rejected=[]
    minimum_speed=height*.05
    launch_direction=0
    for segment in sorted({p.get('segment',0) for p in points}):
        segment_points=sorted((p for p in points if p.get('segment',0)==segment),key=lambda p:p['frame'])
        if segment==0 and (protected_launch is None or segment_points[0]['frame'] in protected_launch):
            # Only the uninterrupted verified launch is protected. A beam can
            # retain segment zero across a long loss and attach to a light.
            prefix=1
            while prefix<len(segment_points) and times[segment_points[prefix]['frame']]-times[segment_points[prefix-1]['frame']]<=2.1/fps:
                prefix+=1
            launch=segment_points[:prefix]
            if len(launch)>=2 and all('stabilized_x' in p for p in launch):
                dx=launch[-1]['stabilized_x']-launch[0]['stabilized_x']
                if abs(dx)>height*.03:launch_direction=1 if dx>0 else -1
            kept.extend(launch);segment_points=segment_points[prefix:]
        run=[];direction=None
        def finish():
            # A returning run needs at least one clear image detection; a short
            # chain of uniformly weak net/background corners is not enough.
            supported=len(run)>=3 and max((p.get('evidence',0.) for p in run),default=0.)>=.6
            if supported and launch_direction:
                duration=times[run[-1]['frame']]-times[run[0]['frame']]
                horizontal_speed=(run[-1]['stabilized_x']-run[0]['stabilized_x'])/duration if duration>0 else 0
                # A panning camera is already compensated here. A recovered
                # helmet/person must not reverse the established flight direction.
                supported=horizontal_speed*launch_direction>=-height*.02
            (kept if supported else rejected).extend(run)
        for point in segment_points:
            if not run:run=[point];direction=None;continue
            previous=run[-1];dt=times[point['frame']]-times[previous['frame']]
            speed=(point['stabilized_y']-previous['stabilized_y'])/dt if dt>0 else 0
            sign=1 if speed>0 else -1
            if dt>2.1/fps or abs(speed)<minimum_speed or (direction is not None and sign!=direction):finish();run=[point];direction=None
            else:run.append(point);direction=sign
        finish()
    return sorted(kept,key=lambda p:p['frame']),[p['frame'] for p in rejected]

def state(point,frame,velocity,segment=0,parent=None):
    history=(parent['history'] if parent else [])+[{'frame':frame,'x':round(point['x'],3),'y':round(point['y'],3),'status':'unreviewed','segment':segment,'evidence':round(point['quality'],3),'net_clear':point.get('net_clear',True),'image_supported':point.get('image_supported',point.get('net_clear',True))}]
    velocity=np.asarray(velocity,dtype=float);acceleration=np.zeros(2)
    if parent and len(parent['history'])>=2:
        acceleration=.6*(velocity-parent['velocity'])/(parent['miss']+1)+.4*parent.get('acceleration',np.zeros(2))
        norm=np.linalg.norm(acceleration)
        if norm>14:acceleration*=14/norm
    samples=(parent.get('samples',[])[-11:] if parent else [])+[(frame,np.array([point['x'],point['y']]))]
    line_run=(parent.get('line_run',0)+1 if parent else 1) if not point.get('net_clear',True) else 0
    return {'pos':np.array([point['x'],point['y']]),'velocity':velocity,'acceleration':acceleration,'miss':0,'history':history,'samples':samples,'line_run':line_run,'score':(parent['score'] if parent else 0)+1.5+point['quality'],'start':np.asarray(parent['start'] if parent else [point['x'],point['y']],float),'area':point['area']}

def advance_beams(beams,points,matrix,frame,spawn,segment,min_speed=.5,entry_radius=None,max_misses=2,perspective_launch=False,max_speed=145,acceleration_allowance=0):
    transported=[]
    for old in beams:
        s={**old,'pos':move(matrix,old['pos']),'start':move(matrix,old['start']),'velocity':matrix[:,:2]@old['velocity'],'acceleration':matrix[:,:2]@old.get('acceleration',np.zeros(2)),'samples':shifted_samples(old.get('samples',[]),matrix)}
        transported.append(s)
    updated=[]
    if transported:
        positions=np.asarray([s['pos'] for s in transported]);velocities=np.asarray([s['velocity'] for s in transported]);gaps=np.asarray([s['miss']+1 for s in transported],float)
        accelerations=np.asarray([s['acceleration'] for s in transported]);speeds=np.linalg.norm(velocities,axis=1);predictions=positions+velocities*gaps[:,None]+accelerations*(gaps*(gaps+1)/2)[:,None];allowances=5+speeds*.15+(gaps-1)*5
        if acceleration_allowance:allowances+=np.minimum(72,acceleration_allowance*gaps**2)
        if entry_radius is not None:allowances=np.maximum(allowances,np.array([entry_radius if len(s['history'])==1 else 0 for s in transported]))
        scores=np.asarray([s['score'] for s in transported])
    for point in points:
        xy=np.array([point['x'],point['y']]);best=None;best_rank=-1e12
        if transported:
            observed_velocities=(xy-positions)/gaps[:,None];observed_speeds=np.linalg.norm(observed_velocities,axis=1);errors=np.linalg.norm(xy-predictions,axis=1)
            turns=np.linalg.norm(observed_velocities-velocities,axis=1)/(8+speeds)
            if perspective_launch:
                # Perspective can reduce angular speed sharply between sparse
                # samples. Rank the initial direction without forcing constant
                # screen speed and accidentally preferring a background feature.
                for index,old in enumerate(transported):
                    if len(old['history'])!=1 or speeds[index]<1:continue
                    ratio=float(observed_velocities[index]@velocities[index]/speeds[index]**2)
                    if .35<=ratio<=1.25:
                        cross=observed_velocities[index,0]*velocities[index,1]-observed_velocities[index,1]*velocities[index,0]
                        errors[index]=abs(float(cross))/speeds[index]*gaps[index]
                        turns[index]=np.linalg.norm(observed_velocities[index]/max(observed_speeds[index],1)-velocities[index]/speeds[index])
            ranks=scores+1.5+point['quality']-errors/allowances-turns*.9-(gaps-1)*.3
            ranks[(observed_speeds<min_speed)|(observed_speeds>max_speed)|(errors>allowances)]=-1e12
            chosen=int(np.argmax(ranks))
            if ranks[chosen]>-1e11:
                old=transported[chosen];best=state(point,frame,observed_velocities[chosen]+accelerations[chosen]*(gaps[chosen]-1)/2,segment,old);best['score']=float(ranks[chosen])
        if best is not None:updated.append(best)
        else:
            initial_velocity=spawn(point)
            if initial_velocity is not None:updated.append(state(point,frame,initial_velocity,segment))
    for old in transported:
        if old['miss']<max_misses:updated.append({**old,'miss':old['miss']+1,'score':old['score']-.7})
    updated.sort(key=lambda s:s['score']+.003*np.linalg.norm(s['pos']-s['start']),reverse=True)
    # Keep several directions alive until there is enough visible motion to choose.
    return updated[:150]

def edge_of(point,w,h,margin=45):
    x,y=point;distances={'left':x,'right':w-1-x,'top':y,'bottom':h-1-y};edge=min(distances,key=distances.get)
    return edge if distances[edge]<margin else None

def scan_hybrid(config,progress=None,launch=None):
    """Verify launch at native cadence, then search sparse frames with that identity."""
    files=config.get('_frames') or sorted(Path(config['frames_dir']).glob('*.jpg'));count=int(config['launch_frame_count']);stride=int(config['source_frame_stride']);times=config['frame_times']
    dense=list(range(min(count,len(files))));coarse=[i for i in dense if i%stride==0]+list(range(count,len(files)))
    def subset(indices):
        return {**config,'_frames':[files[i] for i in indices],'launch_frame_count':0,'frame_times':[times[i] for i in indices]}
    if launch is None:
        launch_config=subset(dense);launch_config.update(fps=config['source_fps'],sampled_frames=False,source_frame_stride=1,launch_only=True)
        launch=scan(launch_config)
    priors={str(i):p for i,original in enumerate(coarse) for p in launch['points'] if p['frame']==original and i>0}
    if not priors:
        return {**launch,'method':'native_launch_not_verified','points':[],'ground_review':None,'contact':config['contact']}
    coarse_config=subset(coarse);coarse_config.update(launch_priors=priors)
    def report(value):
        if progress:
            seen=set(dense)|set(coarse[:int(value['completed'])+1]);progress({**value,'completed':len(seen)-1,'total':len(files)-1})
    result=scan(coarse_config,report);merged={p['frame']:p for p in launch['points']}
    for p in result['points']:
        frame=coarse[p['frame']]
        if frame not in merged:merged[frame]={**p,'frame':frame}
    for gap in result.get('gaps',[]):
        for key in ('start','end'):
            if key in gap:gap[key]=coarse[gap[key]]
    if result.get('ground_review'):
        for key in ('frame','start','end'):
            if key in result['ground_review']:result['ground_review'][key]=coarse[result['ground_review'][key]]
    result.update(points=[merged[i] for i in sorted(merged)],contact=config['contact'],scanned_frames=len(files)-1,last_scanned_frame=len(files)-1,method='native_verified_sparse_track')
    checked=sorted(set(launch['sampling']['detection_frames'])|{coarse[i] for i in result['sampling']['detection_frames']})
    result['sampling'].update(detection_frames=checked,detection_frame_count=len(checked),registered_frames=launch['sampling']['registered_frames']+result['sampling']['registered_frames'])
    result['launch_verification']={'native_observations':len(launch['points']),'coarse_anchor_frames':list(priors)}
    return result


def scan(config,progress=None):
    if config.get('launch_frame_count',0):return scan_hybrid(config,progress)
    cv2.setRNGSeed(0)
    files=config.get('_frames') or sorted(Path(config['frames_dir']).glob('frame-*.jpg'));contact=config['contact'];start=int(contact['frame']);fps=float(config['fps'])
    stride=int(config.get('detection_stride',1))
    if stride<1 or stride>6:raise ValueError('Detection stride must be between 1 and 6 native frames.')
    if start<0 or start>=len(files)-1:raise ValueError('Contact must be before the end of the video.')
    previous=read_frame(files[start],cv2.IMREAD_GRAYSCALE)
    if previous is None:raise ValueError('Cannot read the contact frame.')
    h,w=previous.shape;origin=np.array([contact['x'],contact['y']],float);initial=[];reentry=[];active=None;observed={};segment=0;exit_edge=None;exit_anchor=None;lost_at=None;initial_chosen=False
    sampled=config.get('sampled_frames',False)
    temporal_stride=max(1,int(config.get('source_frame_stride',5 if sampled else 1)))
    initial_window=max(3 if sampled else 12,round(fps*.6));minimum_progress=max(18,w*.1)
    total=len(files)-start-1;debug=[];prefetched=None;cached_motion=None;camera=np.eye(3);cameras={start:camera.copy()};net_orientations=detect_net_orientations(previous);checked=[];dense_until=start+round(fps*.4);field_limit=None;field_checked=-10000;field_gate_until=-1
    reliable_cameras={start:True}
    for frame in range(start+1,len(files)):
        current=prefetched if prefetched is not None else read_frame(files[frame],cv2.IMREAD_GRAYSCALE)
        if current is None:raise ValueError('Cannot decode frame '+str(frame))
        matrix,registered=cached_motion if cached_motion is not None else background_motion(previous,current);origin=move(matrix,origin)
        if exit_anchor is not None:exit_anchor=move(matrix,exit_anchor)
        affine=np.eye(3);affine[:2]=matrix;camera=affine@camera;cameras[frame]=camera.copy()
        reliable_cameras[frame]=bool(registered and reliable_cameras.get(frame-1,False))
        future=read_frame(files[frame+1],cv2.IMREAD_GRAYSCALE) if frame+1<len(files) else None
        future_motion=background_motion(current,future) if future is not None else None
        roi=None
        if active is not None:
            gap=active['miss']+1;predicted=move(matrix,active['pos'])+(matrix[:,:2]@active['velocity'])*gap+(matrix[:,:2]@active['acceleration'])*gap*(gap+1)/2
            radius=110+active['miss']*12
            roi=(predicted[0]-radius,predicted[1]-radius,predicted[0]+radius,predicted[1]+radius)
        elif initial_chosen and exit_edge:
            # Re-entry can occur anywhere along the exit edge. Scan that entire edge on every frame.
            roi={'top':(0,0,w,160),'bottom':(0,h-160,w,h),'left':(0,0,160,h),'right':(w-160,0,w,h)}[exit_edge]
        # A verified sparse launch keeps searching after any loss. Missing
        # frames never end that search or become invented observations.
        can_associate=not initial_chosen or active is not None or exit_edge is not None or sampled
        relative=frame-start
        inspect=stride==1 or not initial_chosen or frame<=dense_until or relative%stride==0
        if active is not None:
            near_border=min(predicted[0],predicted[1],w-1-predicted[0],h-1-predicted[1])<max(16,min(w,h)*.04)
            inspect|=near_border
            if active['velocity'][1]>0 and frame-field_checked>=max(1,round(fps/10)):
                from ground_review import field_mask
                color=read_frame(files[frame]);mask=field_mask(color);ratio=mask.shape[1]/w;x=int(round(predicted[0]*ratio));lo=max(0,x-8);hi=min(mask.shape[1],x+9)
                rows=np.flatnonzero(np.any(mask[:,lo:hi]>0,axis=1)) if hi>lo else []
                field_limit=rows[0]/ratio if len(rows) else None;field_checked=frame
            if active['velocity'][1]>0 and field_limit is not None and predicted[1]>=field_limit-max(24,h*.04,abs(active['velocity'][1])*stride*2):
                dense_until=frame+round(fps*.3);field_gate_until=dense_until;inspect=True
        if can_associate and not inspect:
            if active is not None:active=coast(active,matrix)
            reentry=[{**coast(s,matrix),'score':s['score']-.7} for s in reentry if s['miss']<max(2,stride*2)]
            previous=current;prefetched=future;cached_motion=future_motion
            if progress and (relative%10==0 or relative==total):progress({'completed':relative,'total':total,'detected':len(observed),'detection_frames':len(checked)})
            continue
        if can_associate:checked.append(frame)
        found=candidates(previous,current,matrix,roi,coverage=True,sensitive=active is not None or (sampled and initial_chosen),next_frame=future,next_matrix=future_motion[0] if future_motion else None) if can_associate else []
        if sampled:
            prior=(config.get('launch_priors') or {}).get(str(frame))
            verified=[p for p in found if prior and math.hypot(p['x']-prior['x'],p['y']-prior['y'])<=4]
            compact=compact_ball_evidence(current,found)
            # The native-cadence pass has already verified this exact image
            # observation. Don't lose its identity to a redundant size filter
            # when motion blur makes the ball look larger in a sparse pair.
            found=compact+[p for p in verified if not any(p is q for q in compact)]
        if relative%max(1,round(fps*2))==0:net_orientations=detect_net_orientations(current)
        if net_orientations is not None:found=reject_line_features(current,found,net_orientations)
        if config.get('debug') and relative<=25:debug.append({'frame':frame,'matrix':matrix.tolist(),'candidates':len(found),'active':active['pos'].tolist() if active else None})
        if not initial_chosen:
            def launch(point):
                if config.get('launch_priors'):
                    prior=config['launch_priors'].get(str(frame))
                    if not prior or math.hypot(point['x']-prior['x'],point['y']-prior['y'])>4:return None
                delta=np.array([point['x'],point['y']])-origin;speed=np.linalg.norm(delta)/relative
                # A launch must begin immediately at contact. Starting a new hypothesis
                # half a second later can attach the flight to an unrelated fielder.
                return delta/relative if max(2,w*.006)<speed<145*temporal_stride and relative<=max(2,round(fps*.1)) else None
            initial=advance_beams(initial,found,matrix,frame,launch,0,min_speed=.8,perspective_launch=sampled,max_speed=145*temporal_stride)
            if config.get('debug'):
                debug.append({'initial_frame':frame,'beams':[{'pos':s['pos'].tolist(),'score':s['score'],'miss':s['miss'],'history':s['history']} for s in initial]})
            eligible=[s for s in initial if s['miss']==0 and len(s['history'])>=(2 if sampled else 4) and np.linalg.norm(s['pos']-s['start'])>=minimum_progress]
            if relative>=initial_window or (eligible and relative>=(min(4,total) if config.get('launch_only') else round(fps*.4))):
                if eligible:
                    active=smooth_active(max(eligible,key=lambda s:s['score']+.003*np.linalg.norm(s['pos']-s['start'])))
                    for p in active['history']:observed[p['frame']]=p
                    initial_chosen=True
                elif relative>=initial_window+3:
                    initial_chosen=True;lost_at=frame;exit_edge=None
        elif active is not None:
            projected=move(matrix,active['pos']);velocity=matrix[:,:2]@active['velocity'];acceleration=matrix[:,:2]@active['acceleration'];gap=active['miss']+1;predicted=projected+velocity*gap+acceleration*gap*(gap+1)/2
            options=[]
            for point in found:
                if not point.get('net_clear',True) and active.get('line_run',0)>=2 and not point.get('image_supported',False):continue
                xy=np.array([point['x'],point['y']]);error=float(np.linalg.norm(xy-predicted));allowance=min(35,4+np.linalg.norm(velocity)*.2+active['miss']*4)
                if point.get('image_supported',False):
                    # Short blur-centroid changes can make quadratic image
                    # acceleration overpredict. Compare the linear prediction
                    # too, bounded by the observed blob's size uncertainty.
                    error=min(error,float(np.linalg.norm(xy-(projected+velocity*gap))))
                    allowance=min(35,max(allowance,2*math.sqrt(point['area'])))
                if frame<=field_gate_until:allowance=max(allowance,max(12,h*.025))
                if error>allowance:continue
                size_ratio=max(point['area'],active['area'])/max(1,min(point['area'],active['area']))
                if size_ratio>12:continue
                observed_velocity=(xy-projected)/gap
                if sampled and segment>0 and abs(observed_velocity[1])*fps<h*.05:continue
                turn=float(np.linalg.norm(observed_velocity-velocity))/(8+np.linalg.norm(velocity))
                score=point['quality']-.65*error/allowance-.5*turn-.05*math.log(size_ratio)
                options.append((score,point,observed_velocity))
            options.sort(key=lambda item:item[0],reverse=True)
            if config.get('debug'):debug.append({'active_frame':frame,'predicted':predicted.tolist(),'velocity':velocity.tolist(),'acceleration':acceleration.tolist(),'miss':active['miss'],'options':[{'score':s,'point':p} for s,p,v in options[:3]]})
            if options and options[0][0]>.05 and (len(options)==1 or options[0][0]-options[1][0]>.035):
                _,point,observed_velocity=options[0]
                prior={**active,'pos':projected,'velocity':velocity,'acceleration':acceleration,'start':move(matrix,active['start']),'samples':shifted_samples(active.get('samples',[]),matrix)}
                active=smooth_active(state(point,frame,observed_velocity+acceleration*(gap-1)/2,segment,prior))
                active['history']=active['history'][-6:]
                observed[frame]=active['history'][-1]
            else:
                dense_until=frame+round(fps*.15)
                active={**active,'pos':projected,'start':move(matrix,active['start']),'velocity':velocity,'acceleration':acceleration,'miss':active['miss']+1,'samples':shifted_samples(active.get('samples',[]),matrix)}
                if active['miss']>max(4,round(fps*.2)) or predicted[0]<-5 or predicted[1]<-5 or predicted[0]>w+5 or predicted[1]>h+5:
                    exit_edge=edge_of(predicted,w,h,70);exit_anchor=predicted.copy();lost_at=frame;active=None;reentry=[];segment+=1
        elif exit_edge is not None or sampled:
            # Continue scanning after gaps. A new track needs multiple actual image detections.
            def enter(point):
                x,y=point['x'],point['y'];edge=edge_of((x,y),w,h,max(15,min(w,h)*.06))
                if sampled and exit_edge is not None:
                    distance={'top':y,'bottom':h-1-y,'left':x,'right':w-1-x}[exit_edge]
                    if distance>max(45,min(w,h)*.3):return None
                    edge=exit_edge
                if sampled and exit_edge is None and y>h*.5:return None
                if exit_edge and edge!=exit_edge:return None
                if edge is None and (not sampled or exit_edge is not None or y>h*.5):return None
                if exit_anchor is not None:
                    axis=0 if edge in ('top','bottom') else 1
                    if abs(np.array([x,y])[axis]-exit_anchor[axis])>max(80,w*.3):return None
                return np.array({'top':(0,1),'bottom':(0,-1),'left':(1,0),'right':(-1,0),None:(0,1)}[edge],float)
            near_edge=found
            if exit_edge:
                near_edge=[p for p in found if {'top':p['y']<110,'bottom':p['y']>h-110,'left':p['x']<110,'right':p['x']>w-110}[exit_edge]]
            reentry=advance_beams(reentry,near_edge,matrix,frame,enter,segment,min_speed=.35,entry_radius=max(8,w*.015,h*.1 if sampled else 0),max_misses=max(2,stride*2,round(fps*2) if sampled else 0),acceleration_allowance=h*.015 if sampled else 0)
            if config.get('debug'):debug.append({'reentry_frame':frame,'edge':exit_edge,'anchor':exit_anchor.tolist() if exit_anchor is not None else None,'found':len(found),'beams':[{'position':s['pos'].tolist(),'length':len(s['history']),'miss':s['miss'],'score':s['score']} for s in reentry[:5]]})
            if stride>1 and any(len(s['history'])>=2 and sum(p.get('net_clear',True) for p in s['history'])>=2 for s in reentry):dense_until=frame+round(fps*.25)
            eligible=[]
            for s in reentry:
                sky_return=sampled and exit_edge=='top' and len(s['history'])>=3 and all(p['y']<h*.3 and p.get('net_clear',True) for p in s['history'])
                if sky_return:
                    vectors=np.diff(np.array([xy for _,xy in s['samples']]),axis=0);lengths=np.linalg.norm(vectors,axis=1)
                    sky_return=bool(np.all(lengths>1.5) and np.all(vectors[:,1]>0) and (len(vectors)<2 or np.all(np.sum(vectors[:-1]*vectors[1:],axis=1)/(lengths[:-1]*lengths[1:])>.7)))
                required=3 if sky_return else 4
                if s['miss'] or len(s['history'])<required or np.linalg.norm(s['pos']-s['start'])<6:continue
                if sum(p.get('net_clear',True) for p in s['history'])<3:continue
                velocity=s['velocity'];inward={'top':velocity[1]>0,'bottom':velocity[1]<0,'left':velocity[0]>0,'right':velocity[0]<0}
                if exit_edge and not inward[exit_edge]:continue
                eligible.append(s)
            if eligible:
                active=smooth_active(max(eligible,key=lambda s:s['score']+.003*np.linalg.norm(s['pos']-s['start'])))
                for p in active['history']:
                    if p.get('net_clear',True) and (not sampled or (2<=p['x']<w-2 and 2<=p['y']<h-2)):observed[p['frame']]=p
                reentry=[]
        previous=current
        prefetched=future;cached_motion=future_motion
        if progress and (relative%10==0 or relative==total):progress({'completed':relative,'total':total,'detected':len(observed)})
    points=[observed[f] for f in sorted(observed)];gaps=[];gap_start=None
    for point in points:
        stable=np.linalg.solve(cameras[point['frame']],np.array([point['x'],point['y'],1]))
        point['stabilized_x']=round(float(stable[0]),3);point['stabilized_y']=round(float(stable[1]),3)
    from bracket_refine import refine_between_detections
    points,refinement=refine_between_detections(files,points,cameras,fps,checked,config.get('frame_times'))
    for point in points:point['background_alignment_reliable']=reliable_cameras.get(point['frame'],False)
    if sampled:
        protected_launch={int(frame) for frame in config['launch_priors']} if config.get('launch_priors') else None
        points,rejected_recoveries=confirmed_recovery_points(points,config.get('frame_times',np.arange(len(files))/fps),h,fps,protected_launch)
        refinement['rejected_recovery_frames']=rejected_recoveries
    observed={p['frame']:p for p in points}
    previous_checked=start
    for frame in checked:
        if frame not in observed and gap_start is None:gap_start=frame
        if frame in observed and gap_start is not None:gaps.append({'start':gap_start,'end':previous_checked,'reason':'checked_not_detected'});gap_start=None
        previous_checked=frame
    if gap_start is not None:gaps.append({'start':gap_start,'end':previous_checked,'reason':'checked_not_detected'})
    if previous_checked<len(files)-1:gaps.append({'start':previous_checked+1,'end':len(files)-1,'reason':'track_lost'})
    import importlib,ground_review
    ground=importlib.reload(ground_review).review_ground(files,points,cameras,fps)
    result={'method':'contact_only_image_track_v4','points':points,'gaps':gaps,'contact':contact,'scanned_frames':total,'last_scanned_frame':len(files)-1,'uses_later_manual_seeds':False,'uses_ev_prediction':False,'automatic_acceptance':False,'ground_review':ground,'sampling':{'stride':stride,'registered_frames':total,'detection_frames':checked,'detection_frame_count':len(checked)},'refinement':refinement}
    if config.get('debug'):result['debug']=debug
    return result
