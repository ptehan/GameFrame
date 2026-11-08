import pathlib,sys,json,time,os
root=pathlib.Path(__file__).resolve().parents[1]
os.environ['FFMPEG_PATH']=str(root/'node_modules/ffmpeg-static/ffmpeg.exe')
os.environ['FFPROBE_PATH']=str(root/'node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe')
os.environ['GAMEFRAME_FLIGHT_ACCELERATION']='0'
os.environ['EV_RENDER_WORKERS']='2';os.environ['EV_ENCODER_THREADS']='1'
sys.path.insert(0,str(root/'ev-predictor/synthetic'))
import clip_replay
live=root/'ev-predictor/comparison_output/live';stamp='10586a1da41e4f4982577c09fe49485a'
pkg=json.loads((live/f'observation_package_{stamp}.json').read_text());prediction=json.loads((live/f'direct_video_estimate_{stamp}.json').read_text())
out=root/'demo-output/real-workflow-20261105/two-worker-save.mp4'
best=prediction['direction_first_match']['best'];start=time.perf_counter()
clip_replay.render_clip(pathlib.Path(pkg['video_metadata']['source_path']),pkg,prediction,out,pkg['hit']['contact']['timestamp_s'],1,6,
 ['Workflow timing test',f"EV {best['exit_velocity_mph']:.0f} mph",f"LA {best['launch_angle_deg']:.0f} degrees",f"Distance {best['distance_ft']:.0f} feet"])
result={'seconds':time.perf_counter()-start,'workers':2,'encoder_threads':1,'bytes':out.stat().st_size,'video':str(out)}
out.with_suffix('.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
