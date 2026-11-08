const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync('ev-predictor/app.js', 'utf8');
const start = source.indexOf('function measurementSupportMarkup()');
const end = source.indexOf('\nfunction workflowStatusLine()', start);
const dir = 'ev-predictor/comparison_output/live';
const file = fs.readdirSync(dir).filter(n => /^direct_video_estimate_.*\.json$/.test(n) && JSON.parse(fs.readFileSync(path.join(dir,n),'utf8')).method!=='background_preparation')
  .sort((a,b) => fs.statSync(path.join(dir,b)).mtimeMs-fs.statSync(path.join(dir,a)).mtimeMs)[0];
const prediction = JSON.parse(fs.readFileSync(process.argv[2]||path.join(dir,file),'utf8'));
const context = vm.createContext({state:{latestPrediction:prediction},estimateExplanationOpen:false,
  escapeHtml:s=>s,plainEstimateExplanation:()=>'',formatNumber:(v,n,u)=>Number(v).toFixed(n)+u});
const helperStart=source.indexOf('function usesDescentRate(');
const helper=source.slice(helperStart,source.indexOf('\n',helperStart));
const html = vm.runInContext(helper+'\n'+source.slice(start,end)+'\nmeasurementSupportMarkup()', context);
const primary = html.split('<section class="workflow-estimate-explanation">')[0];
assert.match(primary,/Flights that fit your marks/);
const ranges = prediction.direction_first_match.supported_ranges;
assert.ok(primary.includes(ranges.exit_velocity_mph[0].toFixed(1)));
if (ranges.launch_angle_deg[1]-ranges.launch_angle_deg[0]<.1)
  assert.ok(primary.includes('Estimated launch angle '+Math.round(ranges.launch_angle_deg[0])));
if(prediction.launch_angle_uncertainty?.range_deg) {
  assert.match(html,/endpoints are not necessarily flights that fit your marks/);
  assert.match(html,/not guaranteed accuracy intervals/);
}
console.log('PASS: actual prediction displays fitting models separately from geometry sensitivity.');
