"""Fresh inference first, then explicit reuse checks on the same raw evidence."""
import cProfile
import io
import json
import pstats
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'ev-predictor/synthetic'))
from direct_video_estimate import main
from flight_fit_cache import clear_fit_cache

source = ROOT / 'ev-predictor/comparison_output/live/observation_package_3a5ccaa870e1406b935b9324484197c7.json'
if not source.exists():
    source = ROOT / 'demo-output/speed-benchmark/fresh-input.json'
out = ROOT / 'demo-output/speed-benchmark'
out.mkdir(exist_ok=True)
package = json.loads(source.read_text())
clear_fit_cache()
report = {'source': str(source), 'runs': []}
for label, distance_delta in [('fresh', 0), ('repeat', 0), ('distance_revision', 3)]:
    current = json.loads(json.dumps(package))
    current['hit']['distance_observation']['distance_ft'] += distance_delta
    input_path, output_path = out / (label+'-input.json'), out / (label+'-output.json')
    input_path.write_text(json.dumps(current))
    arguments = [str(input_path), '--db', str(ROOT/'ev-predictor/data/hittrax_from_video.sqlite'), '--out', str(output_path)]
    started = time.perf_counter()
    if label == 'fresh' and '--profile' in sys.argv:
        profiler = cProfile.Profile()
        profiler.runcall(main, arguments)
        profiler.dump_stats(str(out/'fresh.prof'))
        stream = io.StringIO()
        pstats.Stats(profiler, stream=stream).sort_stats('cumtime').print_stats(25)
        (out/'profile.txt').write_text(stream.getvalue())
    else:
        main(arguments)
    result = json.loads(output_path.read_text())['direction_first_match']
    report['runs'].append({'label': label, 'elapsed_seconds': time.perf_counter()-started,
                          'performance': result['performance'], 'best': result['best'],
                          'acceptable': result['acceptable']})
    (out/'report.json').write_text(json.dumps(report, indent=2))
    print(label, report['runs'][-1]['elapsed_seconds'], result['performance'], flush=True)
baseline = json.loads((ROOT/'demo-output/reviewed-staged-latest.json').read_text())['direction_first_match']['best']
for key in ('exit_velocity_mph','launch_angle_deg','distance_ft'):
    assert abs(report['runs'][0]['best'][key]-baseline[key]) < 1e-7, key
    assert report['runs'][1]['best'][key] == report['runs'][0]['best'][key], key
assert not report['runs'][0]['performance']['fit_cache_hit']
assert all(r['performance']['fit_cache_hit'] for r in report['runs'][1:])
print('Fresh result unchanged; repeated and distance-only runs reused unchanged evidence.', flush=True)
