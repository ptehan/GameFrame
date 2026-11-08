"""Overlap native launch verification with the remaining video decode.

Only the source video and confirmed contact enter this path. No saved detections,
fit candidates, field marks, or landing estimates are used.
"""
import math
import re
import subprocess
import threading
import time
from frame_source import jpeg_images, read_frame


def scan_video(config, progress=None):
    import contact_scan
    started = time.monotonic()
    fps = float(config['source_fps'])
    start = float(config['start'])
    stride = max(5, math.floor(fps / 6 + .5))
    dense_end = start + (10 + math.ceil(fps * .4)) / fps
    limit = max(100, 10 + math.ceil(fps * .4) + 60)
    filters = (f'setpts=PTS-STARTPTS,showinfo=checksum=0,'
               f'select=gte(t\\,{start})*lt(t\\,{start+10})*'
               f'(lt(t\\,{dense_end})+not(mod(n\\,{stride}))),'
               "showinfo=checksum=0,scale='min(1280,iw)':'min(1280,ih)':"
               'force_original_aspect_ratio=decrease:force_divisible_by=2')
    command = [config['ffmpeg'], '-v', 'info', '-nostats', '-y', '-t', str(start+10),
               '-threads', '2', '-i', config['video_path'], '-an', '-vf', filters,
               '-frames:v', str(limit), '-fps_mode', 'passthrough', '-q:v', '3',
               '-threads', '2', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1']
    child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    condition = threading.Condition()
    frames, original, sampled, errors = [], [], [], []
    state = {'done': False, 'stderr_done': False, 'time_base': None, 'groups': [], 'tail': []}

    def stderr():
        try:
            for raw in child.stderr:
                line = raw.decode('utf-8', errors='replace')
                with condition:
                    state['tail'] = (state['tail'] + [line])[-20:]
                    base = re.search(r'Parsed_showinfo[^\n]*config in time_base:\s*(\d+)/(\d+)', line)
                    if base and state['time_base'] is None:
                        state['time_base'] = (int(base[1]), int(base[2]))
                    match = re.search(r'\[(Parsed_showinfo_\d+)[^\]]*\][^\n]*?\bn:\s*(\d+)[^\n]*?\bpts:\s*(-?\d+)', line)
                    if match:
                        group = match[1]
                        if group not in state['groups']:
                            state['groups'].append(group)
                        target = original if state['groups'].index(group) == 0 else sampled
                        target.append((int(match[2]), int(match[3])))
                    condition.notify_all()
        except Exception as error:
            errors.append(error)
        finally:
            with condition:
                state['stderr_done'] = True
                condition.notify_all()

    def decode():
        try:
            for frame in jpeg_images(child.stdout):
                with condition:
                    frames.append(frame)
                    if len(frames) > limit:
                        raise ValueError('Decoder exceeded the sampled-frame limit.')
                    condition.notify_all()
            if child.wait() != 0:
                raise ValueError('Video decode failed: ' + ''.join(state['tail']))
        except Exception as error:
            errors.append(error)
        finally:
            with condition:
                state['done'] = True
                state['decode_finished_s'] = time.monotonic()-started
                condition.notify_all()

    stderr_thread = threading.Thread(target=stderr, daemon=True)
    decoder_thread = threading.Thread(target=decode, daemon=True)
    stderr_thread.start(); decoder_thread.start()
    deadline = started + 180

    def available_times():
        return [pts * state['time_base'][0] / state['time_base'][1] for _, pts in sampled[:len(frames)]] if state['time_base'] else []

    def wait_until(predicate):
        with condition:
            while not predicate():
                if errors:
                    raise errors[0]
                if time.monotonic() > deadline:
                    raise TimeoutError('Video frame preparation timed out.')
                condition.wait(.25)
            if errors:
                raise errors[0]

    try:
        if progress:
            progress({'phase': 'decode', 'message': 'Loading launch frames', 'completed': 0, 'total': 0})
        # One sparse frame beyond the dense prefix proves that the prefix is complete.
        wait_until(lambda: state['done'] or any(t >= dense_end-1e-6 for t in available_times()))
        with condition:
            times = available_times()
            count = sum(t < dense_end-1e-6 for t in times)
            prefix = frames[:count]
        if len(prefix) < 2:
            raise ValueError('Not enough launch frames could be decoded.')
        h, w = read_frame(prefix[0]).shape[:2]
        contact = {**config['contact'], 'frame': 0,
                   'x': config['contact']['x']*w/float(config['input_width']),
                   'y': config['contact']['y']*h/float(config['input_height'])}
        config = {**config, 'contact': contact}
        launch_started = time.monotonic()
        if progress:
            progress({'phase': 'launch', 'message': 'Checking launch while loading later frames', 'completed': 0, 'total': 0})
        launch_config = {**config, '_frames': prefix, 'frame_times': times[:count],
                         'fps': fps, 'source_frame_stride': 1, 'sampled_frames': False,
                         'launch_frame_count': 0, 'launch_only': True}
        launch = contact_scan.scan(launch_config)
        launch_done = time.monotonic()
        wait_until(lambda: state['done'] and state['stderr_done'])
        with condition:
            times = available_times()
        if len(times) != len(frames) or abs(times[0]-start) > 2/fps:
            raise ValueError('Sampled frame timestamps could not be matched reliably.')
        by_pts = {pts: number for number, pts in original}
        numbers = [by_pts[pts] for _, pts in sampled[:len(frames)]]
        session = {'width': w, 'height': h, 'times': times, 'frameNumbers': numbers,
                   'sourceFps': fps, 'fps': fps/stride, 'frameStride': stride,
                   'launchFrameCount': count, 'frameCount': len(frames), 'start': start,
                   'duration': min(10, times[-1]-start+stride/fps)}
        result = contact_scan.scan_hybrid({**config, '_frames': frames, 'frame_times': times,
                                         'fps': fps/stride, 'source_frame_stride': stride,
                                         'sampled_frames': True, 'launch_frame_count': count}, progress, launch=launch)
        result['session'] = session
        result['preparation'] = {'launch_started_s': launch_started-started,
                                 'launch_finished_s': launch_done-started,
                                 'decode_finished_s': state.get('decode_finished_s'),
                                 'total_s': time.monotonic()-started,
                                 'jpeg_frames': len(frames), 'uses_saved_detections': False}
        return result
    finally:
        if child.poll() is None:
            child.kill()
        child.wait()
        decoder_thread.join(timeout=5); stderr_thread.join(timeout=5)
        child.stdout.close(); child.stderr.close()
