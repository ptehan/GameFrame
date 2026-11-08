"""Build and validate a replacement database without touching the active file."""
import argparse
from contextlib import closing
from dataclasses import asdict
from datetime import datetime, timezone
from itertools import islice
import json
from pathlib import Path
import shutil
import sqlite3
import time

from baseball_flight import Ball, Environment, StartPosition
from load_sqlite import create_schema, TRUTH_COLUMNS, TRAJECTORY_COLUMNS
from uniform_grid import cases, simulate_batch, validate_batch, DEFAULT_SPEEDS, DEFAULT_LAUNCHES, DEFAULT_SPRAYS


def validate_database(conn, expected_axes):
    axes=('exit_velocity_mph','launch_angle_deg','spray_angle_deg')
    total=1
    for values in expected_axes:total*=len(values)
    actual=conn.execute('SELECT COUNT(*) FROM synthetic_hits').fetchone()[0]
    assert actual==total,(actual,total)
    for axis,values in zip(axes,expected_axes):
        rows=conn.execute(f'SELECT {axis},COUNT(*) FROM synthetic_hits GROUP BY {axis} ORDER BY {axis}').fetchall()
        assert [r[0] for r in rows]==list(values),(axis,rows)
        assert all(r[1]==total//len(values) for r in rows),(axis,'uneven coverage')
    assert conn.execute('PRAGMA quick_check').fetchone()[0]=='ok'
    assert conn.execute('PRAGMA foreign_key_check').fetchone() is None
    missing=conn.execute('''SELECT h.hit_id FROM synthetic_hits h WHERE NOT EXISTS
        (SELECT 1 FROM trajectory_points p WHERE p.hit_id=h.hit_id AND p.relative_time_s=0) LIMIT 1''').fetchone()
    assert missing is None,('missing contact sample',missing)
    # Each flight must contain the complete 0.03 s sequence plus its last
    # airborne 0.01 s integration sample, not merely an initial point.
    incomplete=conn.execute('''WITH samples AS (
        SELECT hit_id,COUNT(*) n,MIN(relative_time_s) first,MAX(relative_time_s) last
        FROM trajectory_points GROUP BY hit_id)
        SELECT h.hit_id,s.n,s.first,s.last,h.hang_time_s FROM synthetic_hits h
        LEFT JOIN samples s ON s.hit_id=h.hit_id
        WHERE s.n IS NULL OR s.first<>0
          OR ABS(s.last-(h.hang_time_s-0.01))>0.000001
          OR s.n <> CAST((ROUND(h.hang_time_s*100)-1)/3 AS INTEGER)+1+
             CASE WHEN (ROUND(h.hang_time_s*100)-1)%3<>0 THEN 1 ELSE 0 END
        LIMIT 1''').fetchone()
    assert incomplete is None,('incomplete trajectory',incomplete)
    return {'synthetic_hits':actual,'trajectory_points':conn.execute('SELECT COUNT(*) FROM trajectory_points').fetchone()[0],
        'complete_cartesian_grid':True,'complete_trajectories':True,'quick_check':'ok','foreign_key_check':'ok'}


def build(source,output,batch_size=1024,speeds=DEFAULT_SPEEDS,launches=DEFAULT_LAUNCHES,sprays=DEFAULT_SPRAYS,resume=False):
    if output.exists() and not resume:raise FileExistsError(f'Refusing to overwrite {output}')
    if source.resolve()==output.resolve():raise ValueError('Build output must differ from the active database')
    output.parent.mkdir(parents=True,exist_ok=True)
    reference=validate_batch()
    print(json.dumps({'reference_parity':reference}),flush=True)
    started=time.perf_counter();count=0;point_count=0;expected=len(speeds)*len(launches)*len(sprays)
    with closing(sqlite3.connect(output)) as conn:
        # Retain calibration and saved analysis/clip tables. Obsolete comparisons
        # to old flight IDs remain in the original file, which becomes the backup.
        if not resume:
            with closing(sqlite3.connect(source.resolve().as_uri()+'?mode=ro',uri=True)) as original:
                original.backup(conn)
            create_schema(conn)
            conn.execute('DROP INDEX idx_trajectory_points_hit_time')
            conn.execute('CREATE UNIQUE INDEX idx_complete_flight_combination ON synthetic_hits(exit_velocity_mph,launch_angle_deg,spray_angle_deg,batter_hand)')
        else:
            if conn.execute("SELECT 1 FROM sqlite_master WHERE name='generation_manifest'").fetchone():
                raise ValueError('Refusing to resume a completed database')
            count=conn.execute('SELECT COUNT(*) FROM synthetic_hits').fetchone()[0]
            point_count=conn.execute('SELECT COUNT(*) FROM trajectory_points').fetchone()[0]
        # This is a disposable staging file. It is never installed until all
        # checks pass; an interrupted unsafe write requires a fresh rebuild.
        conn.execute('PRAGMA journal_mode=OFF')
        conn.execute('PRAGMA synchronous=OFF')
        conn.execute('PRAGMA cache_size=-65536')
        truth_sql=f"INSERT INTO synthetic_hits ({','.join(TRUTH_COLUMNS)}) VALUES ({','.join('?' for _ in TRUTH_COLUMNS)})"
        points_sql=f"INSERT INTO trajectory_points ({','.join(TRAJECTORY_COLUMNS)}) VALUES ({','.join('?' for _ in TRAJECTORY_COLUMNS)})"
        initial_count=count
        iterator=islice(cases(speeds,launches,sprays),count,None)
        while batch:=list(islice(iterator,batch_size)):
            if shutil.disk_usage(output.parent).free<2_000_000_000:
                raise RuntimeError('Less than 2 GB free; stopped before exhausting disk. Active database is unchanged.')
            hits,points=simulate_batch(batch)
            with conn:
                conn.executemany(truth_sql,hits)
                conn.executemany(points_sql,points)
            count+=len(hits);point_count+=len(points)
            elapsed=time.perf_counter()-started
            print(json.dumps({'hits':count,'expected':expected,'points':point_count,'percent':round(100*count/expected,1),
                'elapsed_s':round(elapsed,1),'eta_s':round(elapsed/(count-initial_count)*(expected-count),1)}),flush=True)
        print('Creating trajectory index and validating complete coverage...',flush=True)
        conn.execute('CREATE UNIQUE INDEX idx_trajectory_points_hit_time ON trajectory_points(hit_id,relative_time_s)')
        conn.commit()
        report=validate_database(conn,(speeds,launches,sprays))
        manifest={'schema_version':'uniform-grid-v1','generated_at':datetime.now(timezone.utc).isoformat(),
            'axes':{'exit_velocity_mph':list(speeds),'launch_angle_deg':list(launches),'spray_angle_deg':list(sprays)},
            'batter_hand':'R','estimate_spin':True,'environment':asdict(Environment()),'ball':asdict(Ball()),
            'start_position':asdict(StartPosition()),'integration_step_s':.01,'sample_step_s':.03,
            'final_airborne_sample_retained':True,'reference_parity':reference,'validation':report,
            'elapsed_s':time.perf_counter()-started}
        with conn:
            conn.execute('CREATE TABLE IF NOT EXISTS generation_manifest (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL)')
            conn.execute('INSERT OR REPLACE INTO generation_manifest VALUES(1,?)',(json.dumps(manifest),))
            conn.execute('ANALYZE')
        conn.execute('PRAGMA journal_mode=DELETE')
        conn.execute('PRAGMA synchronous=FULL')
    output.with_suffix('.manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print(json.dumps({'complete':True,'output':str(output),**report,'elapsed_s':round(manifest['elapsed_s'],1)}),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--batch-size',type=int,default=1024)
    parser.add_argument('--resume',action='store_true',help='Resume a staging file stopped cleanly with transactional journaling')
    args=parser.parse_args()
    build(args.source,args.output,args.batch_size,resume=args.resume)
