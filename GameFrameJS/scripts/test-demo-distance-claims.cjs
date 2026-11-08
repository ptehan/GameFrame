const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const prediction=JSON.parse(fs.readFileSync(path.join(root,'demo-output/manual-anchor-check-gap-fixed/prediction.json')));
const fit=prediction.direction_first_match;
const rows=[200,275,325,450,600].map(distance=>{
 const candidates=fit.candidates.filter(c=>Math.abs(c.distance_ft-distance)<=12)
  .sort((a,b)=>a.projected_path_rmse_px-b.projected_path_rmse_px);
 const best=candidates[0];
 return {claimed_distance_ft:distance,distance_tolerance_ft:12,candidates_in_distance_band:candidates.length,
  supported_by_existing_fit_limits:!!best&&best.projected_path_rmse_px<=fit.pixel_error.acceptance_limit_px&&Math.sqrt(best.direction_mse)<=2,
  best:best?{ev_mph:best.exit_velocity_mph,distance_ft:best.distance_ft,spray_deg:best.spray_angle_deg,rmse_px:best.projected_path_rmse_px}:null};
});
assert.equal(rows.find(r=>r.claimed_distance_ft===275).supported_by_existing_fit_limits,true);
assert.equal(rows.find(r=>r.claimed_distance_ft===450).supported_by_existing_fit_limits,false);
assert.equal(rows.find(r=>r.claimed_distance_ft===600).supported_by_existing_fit_limits,false);
const result={purpose:'Controlled distance-claim check, not independent validation of a measured speed',
 constraints:'Same camera, contact origin, launch, spin, timed manual mark and mapped-direction range; no marks moved or physics changed.',
 pixel_limit_px:fit.pixel_error.acceptance_limit_px,rows,
 note:'An empty distance band means no candidate in this evaluated family, not proof that a distance is physically impossible. Current app review/conditional-export policy is separate from this diagnostic.'};
fs.writeFileSync(path.join(root,'demo-output/distance-claim-check.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(rows));
