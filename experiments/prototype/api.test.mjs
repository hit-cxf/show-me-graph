import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {KnowledgeStore} from './knowledge-store.mjs';

const dir=path.dirname(fileURLToPath(import.meta.url));
const corpus=path.resolve(dir,'../corpus');
const localSample=await fs.access(path.join(corpus,'manifest.json')).then(()=>true,()=>false);

async function freePort(){
  const socket=net.createServer();
  socket.listen(0,'127.0.0.1');
  await once(socket,'listening');
  const port=socket.address().port;
  await new Promise((resolve,reject)=>socket.close(error=>error?reject(error):resolve()));
  return port;
}

async function launch(port,file){
  const child=spawn(process.execPath,[path.join(dir,'server.mjs')],{
    cwd:dir,env:{...process.env,SMG_PORT:String(port),SMG_KNOWLEDGE_PATH:file},stdio:['ignore','pipe','pipe']
  });
  let logs='';
  child.stdout.on('data',chunk=>logs+=chunk);
  child.stderr.on('data',chunk=>logs+=chunk);
  const base=`http://127.0.0.1:${port}`;
  for(let i=0;i<60;i++){
    if(child.exitCode!==null)throw new Error(`Test server exited: ${logs}`);
    try{
      const response=await fetch(`${base}/api/health`,{signal:AbortSignal.timeout(200)});
      if(response.ok)return {child,base};
    }catch{}
    await delay(100);
  }
  child.kill('SIGTERM');
  throw new Error(`Test server did not start: ${logs}`);
}

async function stop(child){
  if(child.exitCode===null){child.kill('SIGTERM');await Promise.race([once(child,'exit'),delay(2000)]);}
}

async function request(base,method,route,body,revision){
  const headers={};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(revision!==undefined)headers['If-Match']=`"${revision}"`;
  const response=await fetch(`${base}${route}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();
  return {status:response.status,data,headers:response.headers};
}

test('a source checkout without research data starts with an empty private knowledge base',async()=>{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'smg-empty-'));
  try{
    const file=path.join(temporary,'knowledge.json');
    const store=await KnowledgeStore.open({file,corpus:path.join(temporary,'no-corpus')});
    const snapshot=store.snapshot();
    assert.deepEqual(snapshot.manifest.papers,[]);
    assert.deepEqual(snapshot.graph.entities,[]);
    assert.deepEqual(snapshot.graph.relations,[]);
    assert.deepEqual(snapshot.evidence.evidence,[]);
    assert.deepEqual(snapshot.state.selected_paper_ids,[]);
    assert.equal(snapshot.preferences.maintenance_prompt,'');
    assert.equal((await KnowledgeStore.open({file,corpus:path.join(temporary,'no-corpus')})).snapshot().revision,0);
  }finally{await fs.rm(temporary,{recursive:true,force:true});}
});

test('shared knowledge API persists data and preserves evidence links',{skip:!localSample},async t=>{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'smg-api-'));
  const file=path.join(temporary,'knowledge.json');
  const port=await freePort();
  let server=await launch(port,file);
  t.after(async()=>{await stop(server.child);await fs.rm(temporary,{recursive:true,force:true});});
  const base=server.base;

  const initial=await request(base,'GET','/api/knowledge');
  assert.equal(initial.status,200);
  assert.equal(initial.data.revision,0);
  assert.equal(initial.data.manifest.papers.length,18);
  assert.equal(initial.data.graph.entities.length,50);
  assert.equal(initial.data.evidence.evidence.length,54);
  assert.deepEqual(initial.data.state.selected_paper_ids,[
    'qwen-image-2.0','qwen-image','sd3','dc-ae','qwen-image-vae-2.0','qwen2-rl-report'
  ]);

  let revision=0;
  const tag=await request(base,'POST','/api/knowledge/tags',{id:'test-tag',label:'测试标签'},revision);
  assert.equal(tag.status,201);
  revision=tag.data.revision;
  assert.equal(revision,1);
  const tagged=await request(base,'PATCH','/api/knowledge/entities/qwen2-model',{tag_ids:['test-tag']},revision);
  assert.equal(tagged.status,200);
  revision=tagged.data.revision;
  assert.deepEqual(tagged.data.item.tag_ids,['test-tag']);
  const note=await request(base,'POST','/api/knowledge/notes',{
    id:'test-note',target_type:'entity',target_id:'qwen2-model',body:'由人类添加的备注'
  },revision);
  assert.equal(note.status,201);
  revision=note.data.revision;
  const group=await request(base,'POST','/api/knowledge/groups',{
    id:'test-group',name:'技术主线',paper_ids:['qwen-image-2.0']
  },revision);
  assert.equal(group.status,201);
  revision=group.data.revision;
  const state=await request(base,'PUT','/api/knowledge/state',{
    selected_paper_ids:['qwen-image-2.0'],active_group_id:'test-group'
  },revision);
  assert.equal(state.status,200);
  revision=state.data.revision;

  const stale=await request(base,'PATCH','/api/knowledge/entities/qwen2-model',{description:'stale'},revision-1);
  assert.equal(stale.status,409);
  assert.equal(stale.data.code,'conflict');
  const linkedTag=await request(base,'DELETE','/api/knowledge/tags/test-tag',undefined,revision);
  assert.equal(linkedTag.status,400);
  assert.equal((await request(base,'GET','/api/knowledge')).data.revision,revision);

  const batch=await request(base,'POST','/api/knowledge/batch',{expected_revision:revision,operations:[
    {op:'create',resource:'entities',value:{id:'test-method',kind:'method',label:'完整技术节点',paper_ids:['qwen-image-2.0'],source_ids:['q2-architecture']}},
    {op:'create',resource:'relations',value:{id:'test-relation',source:'paper-qwen-image-2.0',target:'test-method',type:'presents',label:'提出',basis:'inferred',source_ids:['q2-architecture']}}
  ]});
  assert.equal(batch.status,200);
  revision=batch.data.revision;
  assert.equal(batch.data.results[1].provenance.inference_status,'ai_inferred');
  assert.equal(batch.data.results[1].provenance.evidence_status,'linked');
  assert.equal(batch.data.results[1].provenance.origin,'agent');
  const graph=await request(base,'GET','/api/graph');
  assert.ok(graph.data.entities.some(item=>item.id==='test-method'));
  assert.ok(graph.data.relations.some(item=>item.id==='test-relation'));

  const invalid=await request(base,'POST','/api/knowledge/batch',{expected_revision:revision,operations:[
    {op:'create',resource:'entities',value:{id:'orphan',kind:'method',label:'Temporary',paper_ids:['qwen-image-2.0']}},
    {op:'create',resource:'relations',value:{id:'bad-edge',source:'orphan',target:'missing',type:'uses'}}
  ]});
  assert.equal(invalid.status,400);
  assert.equal((await request(base,'GET','/api/knowledge/entities/orphan')).status,404);
  assert.equal((await request(base,'GET','/api/knowledge')).data.revision,revision);

  const evidence=await request(base,'GET','/api/evidence/q2-architecture');
  assert.equal(evidence.status,200);
  assert.equal(evidence.data.artifact_verified,true);
  assert.match(evidence.data.pdf_url,/^\/api\/artifacts\//);
  const pdf=await fetch(base+evidence.data.pdf_url,{method:'HEAD'});
  assert.equal(pdf.status,200);
  assert.match(pdf.headers.get('content-type'),/application\/pdf/);

  const controller=new AbortController();
  const stream=await fetch(`${base}/api/knowledge/events`,{signal:controller.signal});
  assert.equal(stream.status,200);
  assert.match(stream.headers.get('content-type'),/text\/event-stream/);
  const reader=stream.body.getReader();
  const first=new TextDecoder().decode((await reader.read()).value);
  assert.match(first,new RegExp(`"revision":${revision}`));
  const updated=await request(base,'PATCH','/api/knowledge/notes/test-note',{body:'已同步'},revision);
  assert.equal(updated.status,200);
  revision=updated.data.revision;
  const next=new TextDecoder().decode((await reader.read()).value);
  assert.match(next,new RegExp(`"revision":${revision}`));
  controller.abort();

  await stop(server.child);
  const fromDisk=await KnowledgeStore.open({file,corpus});
  assert.equal(fromDisk.snapshot().revision,revision);
  assert.equal(fromDisk.get('notes','test-note').item.body,'已同步');
  server=await launch(port,file);
  const restored=await request(base,'GET','/api/knowledge');
  assert.equal(restored.data.revision,revision);
  assert.deepEqual(restored.data.state.selected_paper_ids,['qwen-image-2.0']);
  assert.ok(restored.data.graph.entities.some(item=>item.id==='test-method'));

  const sameRevision=restored.data.revision;
  const competing=await Promise.all([
    request(base,'POST','/api/knowledge/notes',{id:'parallel-a',target_type:'paper',target_id:'qwen-image-2.0',body:'A'},sameRevision),
    request(base,'POST','/api/knowledge/notes',{id:'parallel-b',target_type:'paper',target_id:'qwen-image-2.0',body:'B'},sameRevision)
  ]);
  assert.deepEqual(competing.map(result=>result.status).sort(),[201,409]);
  revision=sameRevision+1;
  const reviewed=await request(base,'PATCH','/api/knowledge/relations/test-relation',{
    provenance:{origin:'human',review_status:'human_verified'}
  },revision);
  assert.equal(reviewed.status,200);
  assert.equal(reviewed.data.item.provenance.origin,'agent');
  assert.equal(reviewed.data.item.provenance.review_status,'human_verified');
  revision=reviewed.data.revision;
  const removal=await request(base,'POST','/api/knowledge/batch',{expected_revision:revision,operations:[
    {op:'delete',resource:'relations',id:'test-relation'},
    {op:'delete',resource:'entities',id:'test-method'}
  ]});
  assert.equal(removal.status,200);
  assert.equal((await request(base,'GET','/api/knowledge/entities/test-method')).status,404);
});

test('maintenance preferences share revisions, persist, and preserve legacy knowledge',{skip:!localSample},async t=>{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'smg-preferences-api-'));
  const file=path.join(temporary,'knowledge.json');
  const seed=await KnowledgeStore.open({file,corpus});
  assert.deepEqual(seed.snapshot().preferences,{maintenance_prompt:''});
  const legacy=seed.snapshot();
  delete legacy.preferences;
  const legacyBytes=JSON.stringify(legacy,null,2)+'\n';
  await fs.writeFile(file,legacyBytes);
  const port=await freePort();
  let server=await launch(port,file);
  t.after(async()=>{await stop(server.child);await fs.rm(temporary,{recursive:true,force:true});});
  const base=server.base;
  const initial=await request(base,'GET','/api/knowledge/preferences');
  assert.equal(initial.status,200);
  assert.deepEqual(initial.data,{revision:0,preferences:{maintenance_prompt:''}});
  assert.equal(initial.headers.get('etag'),'"0"');
  assert.deepEqual((await request(base,'GET','/api/knowledge')).data,{...legacy,preferences:{maintenance_prompt:''}});
  assert.equal(await fs.readFile(file,'utf8'),legacyBytes,'reading an old database must not rewrite it');

  const controller=new AbortController();
  t.after(()=>controller.abort());
  const stream=await fetch(`${base}/api/knowledge/events`,{signal:controller.signal});
  const reader=stream.body.getReader();
  await reader.read();
  const prompt='优先调研图像生成技术链。\n每项结论须关联原文证据，并区分作者结论与 AI 推断。';
  const saved=await request(base,'PUT','/api/knowledge/preferences',{maintenance_prompt:prompt},0);
  assert.equal(saved.status,200);
  assert.deepEqual(saved.data,{revision:1,preferences:{maintenance_prompt:prompt}});
  assert.equal(saved.headers.get('etag'),'"1"');
  assert.match(new TextDecoder().decode((await reader.read()).value),/"revision":1/);
  controller.abort();
  const afterSave=(await request(base,'GET','/api/knowledge')).data;
  assert.deepEqual(afterSave.graph,legacy.graph);
  assert.deepEqual(afterSave.state,legacy.state);
  assert.deepEqual(afterSave.preferences,{maintenance_prompt:prompt});

  await stop(server.child);
  server=await launch(port,file);
  assert.deepEqual((await request(base,'GET','/api/knowledge/preferences')).data,saved.data);
  const stale=await request(base,'PUT','/api/knowledge/preferences',{maintenance_prompt:'旧草稿'},0);
  assert.equal(stale.status,409);
  assert.equal(stale.data.code,'conflict');
  const invalidBodies=[null,[],{},'prompt',{maintenance_prompt:null},{maintenance_prompt:7},
    {maintenance_prompt:[]},{maintenance_prompt:{}},{maintenance_prompt:true},
    {maintenance_prompt:'valid',unknown:true},{maintenance_prompt:'字'.repeat(20001)}];
  for(const body of invalidBodies){
    const invalid=await request(base,'PUT','/api/knowledge/preferences',body,1);
    assert.equal(invalid.status,400);
    assert.equal(invalid.data.code,'validation_error');
  }
  assert.deepEqual((await request(base,'GET','/api/knowledge')).data,afterSave,'failed writes must preserve the entire snapshot');
  assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),afterSave);

  const note=await request(base,'POST','/api/knowledge/notes',{
    id:'preferences-test-note',target_type:'paper',target_id:'qwen-image-2.0',body:'ordinary CRUD preserves preferences'
  },1);
  assert.equal(note.status,201);
  assert.deepEqual((await request(base,'GET','/api/knowledge/preferences')).data,{revision:2,preferences:{maintenance_prompt:prompt}});
  const competing=await Promise.all([
    request(base,'PUT','/api/knowledge/preferences',{maintenance_prompt:'同时提交 A'},2),
    request(base,'PUT','/api/knowledge/preferences',{maintenance_prompt:'同时提交 B'},2)
  ]);
  assert.deepEqual(competing.map(result=>result.status).sort(),[200,409]);
  assert.equal((await request(base,'GET','/api/knowledge/preferences')).data.revision,3);

  const limit=await request(base,'PUT','/api/knowledge/preferences',{maintenance_prompt:'字'.repeat(20000)},3);
  assert.equal(limit.status,200);
  const cleared=await request(base,'PUT','/api/knowledge/preferences',{maintenance_prompt:''},4);
  assert.equal(cleared.status,200);
  assert.deepEqual(cleared.data,{revision:5,preferences:{maintenance_prompt:''}});
  await stop(server.child);
  server=await launch(port,file);
  const restored=(await request(base,'GET','/api/knowledge')).data;
  assert.deepEqual(restored.preferences,{maintenance_prompt:''});
  assert.equal(restored.revision,5);
  assert.deepEqual(restored.graph,legacy.graph);
  assert.deepEqual(restored.state,legacy.state);
  assert.equal(restored.notes.find(note=>note.id==='preferences-test-note').body,'ordinary CRUD preserves preferences');
});

test('API preserves Chinese and formulas when UTF-8 characters cross request chunks',{skip:!localSample},async t=>{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'smg-utf8-api-'));
  const file=path.join(temporary,'knowledge.json'),port=await freePort();
  const server=await launch(port,file);
  t.after(async()=>{await stop(server.child);await fs.rm(temporary,{recursive:true,force:true});});
  const prompt='中文知识图谱：∇θ，阶段关系与来源 🧪';
  const bytes=Buffer.from(JSON.stringify({maintenance_prompt:prompt}));
  const cuts=[bytes.indexOf(Buffer.from('中'))+1,bytes.indexOf(Buffer.from('∇'))+2,bytes.indexOf(Buffer.from('🧪'))+2];
  const response=await new Promise((resolve,reject)=>{
    const req=http.request(`${server.base}/api/knowledge/preferences`,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'"0"'}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(Buffer.concat(chunks).toString('utf8'))}));res.on('error',reject);
    });
    req.on('error',reject);
    (async()=>{let start=0;for(const end of cuts){req.write(bytes.subarray(start,end));start=end;await delay(25);}req.end(bytes.subarray(start));})().catch(reject);
  });
  assert.equal(response.status,200);
  assert.equal(response.data.preferences.maintenance_prompt,prompt);
  assert.equal((await request(server.base,'GET','/api/knowledge/preferences')).data.preferences.maintenance_prompt,prompt);
});
