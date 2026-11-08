const test=require('node:test'),assert=require('node:assert/strict');
const {summarizeMeasurements,measurementWindow}=require('../measurement-summary');
test('empty and missing values do not become zero measurements',()=>{
 assert.equal(summarizeMeasurements([null,undefined,NaN,Infinity,'80']).count,0);
 assert.equal(summarizeMeasurements([]).mean,null);
});
test('mean median range and sample deviation reflect the measured samples',()=>{
 const s=summarizeMeasurements([80,82,84,null]);
 assert.deepEqual(s,{count:3,mean:82,median:82,min:80,max:84,standardDeviation:2});
 assert.equal(summarizeMeasurements([75]).standardDeviation,null);
 assert.equal(summarizeMeasurements([75,85]).median,80);
});
test('timing fixtures distinguish repeatability without preferring short intervals',()=>{
 const short=summarizeMeasurements([.4,.4,.4]);
 const long=summarizeMeasurements([.9,.9,.9]);
 assert.ok(short.standardDeviation<1e-10);
 assert.ok(long.standardDeviation<1e-10);
 assert.ok(summarizeMeasurements([.4,.7,.9]).standardDeviation>.2);
});
test('date windows exclude old, future and invalid dates, and all preserves records',()=>{
 const rows=[{measured_at:'2026-10-21 12:00:00'},{measured_at:'2026-08-01 12:00:00'},{measured_at:'invalid'},{measured_at:'2027-01-01 00:00:00'}];
 assert.equal(measurementWindow(rows,'7',Date.parse('2026-10-22T12:00:00Z')).length,1);
 assert.equal(measurementWindow(rows,'all').length,4);
});
