const fs = require('node:fs');
const Database = require('better-sqlite3');
const id = Number(process.argv[2] || 61);
const db = new Database('app.db', {readonly: true});
const row = db.prepare('SELECT observation_package_json FROM ev_hit_tracks WHERE id=?').get(id);
db.close();
if (!row) throw new Error('Hit not found');
const packet = JSON.parse(row.observation_package_json);
packet.ball_observations = packet.ball_observations.filter(p => p.source === 'HUMAN');
(async () => {
  const response = await fetch('http://localhost:8000/api/predict', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(packet)
  });
  if (!response.ok) throw new Error(await response.text());
  const result = await response.json();
  fs.writeFileSync(`demo-output/hit-${id}-manual-only-prediction.json`, JSON.stringify(result, null, 2));
  const fit = result.direction_first_match;
  console.log(JSON.stringify({marks: packet.ball_observations, used: fit.used_count,
    launch: fit.common_launch_angle_deg, origin: fit.contact_origin_ft,
    pixel_error: fit.pixel_error, refinement: fit.spray_refinement,
    candidates: fit.candidates.slice(0, 10).map(c => ({id: c.hit_id,
      source: c.source_hit_id, ev: c.exit_velocity_mph, launch: c.launch_angle_deg,
      spray: c.spray_angle_deg, distance: c.distance_ft, error: c.projected_path_rmse_px,
      projected: c.projected_pixels}))}, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
