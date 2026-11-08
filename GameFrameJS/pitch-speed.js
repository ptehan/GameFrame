const { normalizeVideoFps } = require('./pitch-vision');
const { calculateManualPitch } = require('./static/js/pitch-release-picker');

function measurePitch(row, input) {
  const number = key => {
    if (input[key] === null || input[key] === undefined || input[key] === '') throw new Error('Missing ' + key + '.');
    const value = Number(input[key]);
    if (!Number.isFinite(value)) throw new Error('Invalid ' + key + '.');
    return value;
  };
  const release = number('release_frame'), mound = number('mound_distance');
  if (!Number.isInteger(release * 2) || mound < 10 || mound > 100) throw new Error('Invalid release frame or mound distance.');
  if (!Number.isInteger(row.contact_frame) || row.contact_frame < 1 || !(row.fps > 0)) throw new Error('Pitch has no valid contact timing.');
  return calculateManualPitch({selection:{start:0,end:row.contact_frame-0.5},contact_frame:row.contact_frame,
    timing_fps:normalizeVideoFps(row.fps),settings:{pitching_feet:mound}},release,number('extension'),number('contact_adjustment'));
}

function savedPitchSpeed(row) {
  if (!row || row.release_frame == null) return null;
  return measurePitch(row,{release_frame:row.release_frame,mound_distance:row.mound_distance,
    extension:row.release_extension,contact_adjustment:row.contact_adjustment});
}

module.exports = { measurePitch, savedPitchSpeed };
