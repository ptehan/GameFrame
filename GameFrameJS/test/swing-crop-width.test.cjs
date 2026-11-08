const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
for(const kind of ['swing','pitch']){
const html=fs.readFileSync(require('node:path').join(__dirname,`../templates/upload_${kind}_trim.html`),'utf8');
const body=html.match(/function normalizePortraitCropFromControls\(\) \{([\s\S]*?)\n\}/)[0];
for(const [width,height]of [[1280,720],[640,720],[720,1280]])test(`${kind} crop retains a physical 8:9 view in ${width}x${height} frames`,()=>{
 const context=vm.createContext({frames:[{width,height}],portraitCropZoom:{value:'0'},portraitCropX:{value:'.5'},portraitCropY:{value:'.5'},FIXED_PORTRAIT_ASPECT:8/9,portraitCropState:null});
 const crop=vm.runInContext(body+';normalizePortraitCropFromControls()',context);
 assert(crop.x>=0&&crop.y>=0&&crop.x+crop.w<=1&&crop.y+crop.h<=1);
 // A narrow original cannot provide additional horizontal pixels.
 assert(Math.abs(crop.w*width/(crop.h*height)-Math.min(8/9,width/(crop.h*height)))<1e-9);
});
}
