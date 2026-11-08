const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../ev-predictor/app.js'), 'utf8');
const start = source.indexOf('function landingDistanceMismatch(');
const end = source.indexOf('function landingReviewText(', start);
function context(prediction) {
  const ctx = vm.createContext({state:{latestPrediction:prediction}, landingReviewAcknowledged:null});
  vm.runInContext(source.slice(start, end), ctx);
  return ctx;
}
const prediction = (modeled, marked) => ({direction_first_match:{best:{distance_ft:modeled}},field_direction:{estimated_distance_ft:marked}});
test('distance review requires a substantial absolute and relative mismatch in either direction', () => {
  const ctx = context(null);
  for (const pair of [[270,324],[335,260],[200,300]]) assert.ok(ctx.landingDistanceMismatch(prediction(...pair)));
  for (const pair of [[300,320],[300,340],[400,450],[0,324],[300,null]]) assert.equal(ctx.landingDistanceMismatch(prediction(...pair)), null);
  assert.equal(ctx.landingDistanceMismatch(null), null);
});
test('current shared match takes priority over legacy fit; missing current fit can use path-only', () => {
  const ctx = context(null), p = prediction(320,324);
  p.path_only_model_fit = {best:{distance_ft:200}};
  assert.equal(ctx.landingDistanceMismatch(p),null);
  delete p.direction_first_match;
  assert.ok(ctx.landingDistanceMismatch(p));
});
test('keep mark acknowledges only this prediction, not a later recalculation', () => {
  const ctx = context(prediction(270,324));
  assert.equal(ctx.needsLandingReview(),true);
  ctx.landingReviewAcknowledged = ctx.state.latestPrediction;
  assert.equal(ctx.needsLandingReview(),false);
  ctx.state.latestPrediction = prediction(270,324);
  assert.equal(ctx.needsLandingReview(),true);
});
