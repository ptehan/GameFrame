// Source inventory only. Does not import the application or open its database.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),natives=process.binding('natives'),mod={exports:{}};
vm.runInThisContext('(function(exports,module){'+natives['internal/deps/acorn/acorn/dist/acorn']+'\n})')(mod.exports,mod);
const acorn=mod.exports;
const roots=['server.js','usage-auth.js','ev-worker.js','pitch-speed.js','pitch-source.js','pitch-speed-export.js','pitch-vision.js','measurement-summary.js','desktop','static/js','templates','ev-predictor/app.js','ev-predictor/index.html','ev-predictor/predictor.html','experiments/ball-assist/server.cjs','experiments/ball-assist/app-integration.cjs','experiments/ball-assist/model-worker.cjs','experiments/ball-assist/public/index.html'];
const files=[];
function add(name){const full=path.join(root,name);if(!fs.existsSync(full))return;const stat=fs.statSync(full);if(stat.isDirectory()){for(const entry of fs.readdirSync(full))if(!['node_modules','__pycache__','public'].includes(entry))add(path.join(name,entry));}else if(/\.(js|cjs|html)$/.test(name)&&!/(test|check|benchmark|replay|profile|inspect|audit|verify|compare|contact-frame|frame-rate|freeze-)/i.test(path.basename(name)))files.push(name.replaceAll('\\','/'));}
roots.push('scripts/start-all.js','scripts/build-desktop.js','static/service-worker.js');
roots.forEach(add);
const result={files:[],functions:[],routes:[],errors:[]};
function walk(node,visit,parent=null,stack=[]){if(!node||typeof node!=='object')return;if(node.type){visit(node,parent,stack);stack=[...stack,node];}for(const [key,value]of Object.entries(node)){if(['loc','start','end'].includes(key))continue;if(Array.isArray(value))for(const child of value)walk(child,visit,node,stack);else if(value&&typeof value==='object')walk(value,visit,node,stack);}}
function value(node,source){if(!node)return'';if(node.type==='Literal')return String(node.value);return source.slice(node.start,node.end).replace(/\s+/g,' ').slice(0,160);}
function member(node,source){return node?.type==='MemberExpression'?member(node.object,source)+'.'+value(node.property,source):value(node,source);}
function inputFields(node,source){const found=new Set();walk(node,n=>{if(n.type==='MemberExpression'){const name=member(n,source);if(/^req\.(body|query|params)\.[\w]+$/.test(name))found.add(name.replace('req.',''));}});return [...found].sort();}
for(const file of [...new Set(files)].filter(f=>!f.startsWith('static/js/ffmpeg')&&!f.includes('814.ffmpeg')&&!f.includes(' - Copy')).sort()){
 const text=fs.readFileSync(path.join(root,file),'utf8');result.files.push({file,sha256:crypto.createHash('sha256').update(text).digest('hex'),lines:text.split('\n').length});
 const scripts=file.endsWith('.html')?[...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(m=>!/(src\s*=|application\/json)/i.test(m[1])).map(m=>({source:m[2],line:text.slice(0,m.index+m[0].indexOf('>')+1).split('\n').length-1})):[{source:text,line:0}];
 for(const script of scripts){
  let source=script.source.replace(/\{\{[\s\S]*?\}\}/g,m=>'TEMPLATE'+m.replace(/[^\n]/g,'').slice(0)).replace(/\{%[\s\S]*?%\}/g,m=>m.replace(/[^\n]/g,' ')).replace(/\{#[\s\S]*?#\}/g,m=>m.replace(/[^\n]/g,' '));
  source=source.replace(/\bTEMPLATE\s+null(?=\s*;)/g,'TEMPLATE');
  let ast;try{ast=acorn.parse(source,{ecmaVersion:'latest',allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true,locations:true});}catch(error){result.errors.push({file,line:script.line+error.loc.line,error:error.message});continue;}
  walk(ast,(node,parent,stack)=>{
   if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)){
    let name=node.id?.name,kind='function';
    if(!name&&parent?.type==='VariableDeclarator')name=value(parent.id,source);
    if(!name&&parent?.type==='AssignmentExpression')name=value(parent.left,source);
    if(!name&&['Property','MethodDefinition'].includes(parent?.type))name=value(parent.key,source);
    if(!name&&parent?.type==='CallExpression'&&parent.callee?.property?.name==='addEventListener'){name=member(parent.callee.object,source)+' event '+value(parent.arguments[0],source);kind='event';}
    if(!name)return;
    const owner=[...stack].reverse().find(n=>n.type==='ClassDeclaration'||n.type==='FunctionDeclaration'&&n.id?.name);
    const calls=new Set();walk(node.body,n=>{if(n.type==='CallExpression')calls.add(member(n.callee,source));});
    result.functions.push({file,line:script.line+node.loc.start.line,endLine:script.line+node.loc.end.line,name,owner:owner?.id?.name||null,kind,async:node.async,signature:'('+node.params.map(p=>value(p,source)).join(', ')+')',calls:[...calls].filter(n=>n.length<85).slice(0,8)});
   }
   if(node.type==='CallExpression'&&node.callee?.type==='MemberExpression'&&node.callee.object?.name==='app'&&['get','post','put','patch','delete','use','all'].includes(node.callee.property.name)){
    const method=node.callee.property.name.toUpperCase(),first=node.arguments[0];if(!first||!['Literal','ArrayExpression','Identifier'].includes(first.type))return;
    const endpoints=first.type==='ArrayExpression'?first.elements.map(x=>value(x,source)):[value(first,source)];
    const handlers=node.arguments.slice(1);const inputs=new Set(),statuses=new Set(),jsonKeys=new Set(),templates=new Set();
    for(const handler of handlers){inputFields(handler,source).forEach(x=>inputs.add(x));walk(handler,n=>{if(n.type!=='CallExpression'||n.callee?.type!=='MemberExpression')return;const prop=n.callee.property.name;if(['status','sendStatus'].includes(prop)&&n.arguments[0]?.type==='Literal')statuses.add(n.arguments[0].value);if(prop==='json'&&n.arguments[0]?.type==='ObjectExpression')for(const key of n.arguments[0].properties)jsonKeys.add(value(key.key,source));if(n.callee.object?.name==='res'&&prop==='redirect')templates.add('redirect');if(n.callee?.name==='render')templates.add('HTML');});}
    for(const endpoint of endpoints)result.routes.push({file,line:script.line+node.loc.start.line,method,path:endpoint,inputs:[...inputs],statuses:[...statuses].sort(),jsonKeys:[...jsonKeys],handlers:handlers.filter(n=>n.type!=='FunctionExpression'&&n.type!=='ArrowFunctionExpression').map(n=>value(n,source))});
   }
  });
 }
}
fs.writeFileSync(path.join(__dirname,'javascript-inventory.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({files:result.files.length,namedFunctions:result.functions.length,routes:result.routes.length,parseErrors:result.errors}));
