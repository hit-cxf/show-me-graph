import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import {fileURLToPath} from 'node:url';
import {KnowledgeStore,KnowledgeError,KNOWLEDGE_RESOURCES} from './knowledge-store.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const corpus=process.env.SMG_CORPUS_PATH||path.join(root,'experiments/corpus');
const researchCorpus=path.join(root,'research/corpus');
const dist=path.join(root,'experiments/prototype/dist');
const port=Number(process.env.SMG_PORT || 4317);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid SMG_PORT');
const databasePath=process.env.SMG_KNOWLEDGE_PATH||path.join(root,'experiments/prototype/.runtime/knowledge.json');
const store=await KnowledgeStore.open({file:databasePath,corpus});
const hashes=new Map();
const events=new Set();
store.on('revision',revision=>{
  for(const response of events)response.write(`event: revision\ndata: ${JSON.stringify({revision})}\n\n`);
});

async function artifact(paper) {
  if(!paper.pdf?.artifact_path||!paper.pdf?.sha256)throw new KnowledgeError(404,'not_found','PDF unavailable');
  const p=await fs.realpath(path.resolve(root,paper.pdf.artifact_path));
  const allowed=await Promise.all([corpus,researchCorpus].map(base=>fs.realpath(base)));
  if(!allowed.some(base=>p.startsWith(base+path.sep)))throw new KnowledgeError(403,'forbidden','Artifact outside allowed corpus');
  const stat=await fs.stat(p), key=`${p}:${stat.size}:${stat.mtimeMs}`;
  if(!hashes.has(key))hashes.set(key,crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex'));
  if(hashes.get(key)!==paper.pdf.sha256)throw new KnowledgeError(409,'conflict','Artifact hash mismatch');
  return p;
}

async function jsonBody(req){
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw new KnowledgeError(415,'unsupported_media_type','Use Content-Type: application/json');
  let text='',size=0;const decoder=new StringDecoder('utf8');
  for await(const chunk of req){
    size+=chunk.length;
    if(size>20*1024*1024)throw new KnowledgeError(413,'payload_too_large','JSON body exceeds 20 MiB');
    text+=decoder.write(chunk);
  }
  text+=decoder.end();
  try{return JSON.parse(text);}catch{throw new KnowledgeError(400,'invalid_json','Invalid JSON body');}
}

function expectedRevision(req){
  const header=req.headers['if-match'];
  if(header===undefined)return undefined;
  const match=String(header).match(/^"?(\d+)"?$/);
  if(!match)throw new KnowledgeError(400,'validation_error','If-Match must be a numeric revision, optionally quoted');
  return Number(match[1]);
}

const server=http.createServer(async(req,res)=>{
  const send=(code,data,type='application/json')=>{
    const headers={'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    if(data&&typeof data==='object'&&Number.isInteger(data.revision))headers.ETag=`"${data.revision}"`;
    res.writeHead(code,headers);
    res.end(type==='application/json'?JSON.stringify(data):data);
  };
  try {
    if(!['127.0.0.1','localhost'].includes((req.headers.host||'').split(':')[0]))return send(403,{error:'Local host only',code:'forbidden'});
    if(req.headers.origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(req.headers.origin))
      return send(403,{error:'Cross-origin writes are disabled',code:'forbidden'});
    const url=new URL(req.url,`http://127.0.0.1:${port}`);
    const pathname=url.pathname;
    if(pathname==='/api/health'){
      if(req.method!=='GET'&&req.method!=='HEAD')return send(405,{error:'Method not allowed',code:'method_not_allowed'});
      return send(200,{app:'show-me-graph',stage:'M1',read_only:false,pid:process.pid,revision:store.snapshot().revision});
    }
    if(pathname==='/api/knowledge/events'){
      if(req.method!=='GET')return send(405,{error:'Method not allowed',code:'method_not_allowed'});
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Content-Type-Options':'nosniff'});
      res.write(`event: revision\ndata: ${JSON.stringify({revision:store.snapshot().revision})}\n\n`);
      events.add(res);
      req.on('close',()=>events.delete(res));
      return;
    }
    if(pathname==='/api/knowledge'){
      if(req.method!=='GET'&&req.method!=='HEAD')return send(405,{error:'Method not allowed',code:'method_not_allowed'});
      return send(200,store.snapshot());
    }
    if(pathname==='/api/knowledge/batch'){
      if(req.method!=='POST')return send(405,{error:'Method not allowed',code:'method_not_allowed'});
      const body=await jsonBody(req),headerRevision=expectedRevision(req);
      if(!body||typeof body!=='object'||Array.isArray(body))throw new KnowledgeError(400,'validation_error','Batch body must be an object');
      const revision=headerRevision??body.expected_revision;
      if(revision!==undefined&&(!Number.isInteger(revision)||revision<0))throw new KnowledgeError(400,'validation_error','expected_revision must be a nonnegative integer');
      const result=await store.batch(body.operations,{actor:req.headers['x-smg-actor']==='human'?'human':'agent',expectedRevision:revision});
      return send(200,result);
    }
    if(pathname==='/api/knowledge/state'){
      if(req.method==='GET'||req.method==='HEAD')return send(200,{revision:store.snapshot().revision,state:store.snapshot().state});
      if(req.method!=='PUT')return send(405,{error:'Method not allowed',code:'method_not_allowed'});
      return send(200,await store.setState(await jsonBody(req),{expectedRevision:expectedRevision(req)}));
    }
    if(pathname==='/api/knowledge/preferences'){
      if(req.method==='GET'||req.method==='HEAD'){
        const snapshot=store.snapshot();
        return send(200,{revision:snapshot.revision,preferences:snapshot.preferences});
      }
      if(req.method!=='PUT')return send(405,{error:'Method not allowed',code:'method_not_allowed'});
      return send(200,await store.setPreferences(await jsonBody(req),{expectedRevision:expectedRevision(req)}));
    }
    const resourceMatch=pathname.match(/^\/api\/knowledge\/([^/]+)(?:\/([^/]+))?$/);
    if(resourceMatch){
      const resource=resourceMatch[1],id=resourceMatch[2]?decodeURIComponent(resourceMatch[2]):null;
      if(!KNOWLEDGE_RESOURCES.includes(resource))throw new KnowledgeError(404,'not_found','Unknown resource');
      if(req.method==='GET'||req.method==='HEAD')return send(200,id?store.get(resource,id):store.list(resource));
      if(req.method==='POST'&&!id)return send(201,await store.operate({op:'create',resource,value:await jsonBody(req)},
        {actor:req.headers['x-smg-actor']==='human'?'human':'agent',expectedRevision:expectedRevision(req)}));
      if(req.method==='PATCH'&&id)return send(200,await store.operate({op:'patch',resource,id,value:await jsonBody(req)},
        {actor:req.headers['x-smg-actor']==='human'?'human':'agent',expectedRevision:expectedRevision(req)}));
      if(req.method==='DELETE'&&id)return send(200,await store.operate({op:'delete',resource,id},
        {actor:req.headers['x-smg-actor']==='human'?'human':'agent',expectedRevision:expectedRevision(req)}));
      return send(405,{error:'Method not allowed',code:'method_not_allowed'});
    }
    const snapshot=store.snapshot();
    if(pathname==='/api/graph'||pathname==='/api/manifest'||pathname==='/api/evidence'){
      if(req.method!=='GET'&&req.method!=='HEAD')return send(405,{error:'Method not allowed',code:'method_not_allowed'});
      return send(200,snapshot[{ '/api/graph':'graph','/api/manifest':'manifest','/api/evidence':'evidence'}[pathname]]);
    }
    if(pathname.startsWith('/api/evidence/')){
      if(req.method!=='GET'&&req.method!=='HEAD')return send(405,{error:'Method not allowed',code:'method_not_allowed'});
      const e=snapshot.evidence.evidence.find(x=>x.id===decodeURIComponent(pathname.slice('/api/evidence/'.length)));
      if(!e)return send(404,{error:'Unknown evidence',code:'not_found'});
      const p=snapshot.manifest.papers.find(x=>x.paper_id===e.paper_id);
      if(!p||e.sha256!==p.pdf?.sha256)return send(409,{error:'Evidence version mismatch',code:'conflict'});
      await artifact(p);
      return send(200,{...e,artifact_verified:true,pdf_url:`/api/artifacts/${encodeURIComponent(p.paper_id)}/file`});
    }
    const match=pathname.match(/^\/api\/artifacts\/([^/]+)\/file$/);
    if(match){
      if(req.method!=='GET'&&req.method!=='HEAD')return send(405,{error:'Method not allowed',code:'method_not_allowed'});
      const p=snapshot.manifest.papers.find(x=>x.paper_id===decodeURIComponent(match[1]));
      if(!p||p.pdf?.status!=='downloaded')return send(404,{error:'PDF unavailable',code:'not_found'});
      return send(200,await fs.readFile(await artifact(p)),'application/pdf');
    }
    if(req.method!=='GET'&&req.method!=='HEAD')return send(405,{error:'Method not allowed',code:'method_not_allowed'});
    const target=path.resolve(dist,'.'+decodeURIComponent(pathname==='/'?'/index.html':pathname));
    if(!target.startsWith(dist+path.sep))return send(403,{error:'Invalid path',code:'forbidden'});
    const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.mjs':'text/javascript','.wasm':'application/wasm'};
    return send(200,await fs.readFile(target),types[path.extname(target)]||'application/octet-stream');
  } catch(error) {
    if(res.headersSent){res.destroy(error);return;}
    const status=error.status||(error.code==='ENOENT'?404:500);
    send(status,{error:error.message,code:error instanceof KnowledgeError?error.code:error.code==='ENOENT'?'not_found':'internal_error'});
  }
});
server.listen(port,'127.0.0.1',()=>console.log(`Show Me Graph M1: http://127.0.0.1:${port}`));
