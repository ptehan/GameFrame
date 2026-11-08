'use strict';

function summarizeMeasurements(values) {
  const valid = values.filter(value => typeof value === 'number' && Number.isFinite(value));
  if (!valid.length) return {count:0, mean:null, median:null, min:null, max:null, standardDeviation:null};
  const sorted = [...valid].sort((a,b)=>a-b);
  const mean = valid.reduce((sum,value)=>sum+value,0)/valid.length;
  const mid = Math.floor(sorted.length/2);
  return {
    count: valid.length,
    mean,
    median: sorted.length%2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2,
    min: sorted[0], max: sorted[sorted.length-1],
    standardDeviation: valid.length>1 ? Math.sqrt(valid.reduce((sum,value)=>sum+(value-mean)**2,0)/(valid.length-1)) : null
  };
}

function measurementWindow(rows, days, now = Date.now()) {
  if (days === 'all') return rows;
  const cutoff = now-Number(days)*86400000;
  return rows.filter(row=>{
    const text=String(row.measured_at||'');
    const date=Date.parse(/Z$|[+-]\d\d:\d\d$/.test(text)?text:text.replace(' ','T')+'Z');
    return Number.isFinite(date) && date>=cutoff && date<=now;
  });
}
module.exports={summarizeMeasurements,measurementWindow};
