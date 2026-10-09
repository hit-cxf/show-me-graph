import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const dir=path.dirname(fileURLToPath(import.meta.url));
const localSample=await fs.access(path.resolve(dir,'../corpus/manifest.json')).then(()=>true,()=>false);
const executablePath=process.env.SMG_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function freePort(){
  const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');
  const port=listener.address().port;
  await new Promise((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));
  return port;
}
async function startServer(port,file){
  const child=spawn(process.execPath,[path.join(dir,'server.mjs')],{
    cwd:dir,env:{...process.env,SMG_PORT:String(port),SMG_KNOWLEDGE_PATH:file},stdio:['ignore','pipe','pipe']
  });
  let logs='';child.stdout.on('data',chunk=>logs+=chunk);child.stderr.on('data',chunk=>logs+=chunk);
  const base=`http://127.0.0.1:${port}`;
  for(let i=0;i<60;i++){
    if(child.exitCode!==null)throw new Error(`Test server exited: ${logs}`);
    try{if((await fetch(`${base}/api/health`,{signal:AbortSignal.timeout(200)})).ok)return {base,child};}catch{}
    await delay(100);
  }
  child.kill('SIGTERM');throw new Error(`Test server did not start: ${logs}`);
}
async function stopServer(child){
  if(child?.exitCode===null){child.kill('SIGTERM');await Promise.race([once(child,'exit'),delay(2000)]);}
}
async function api(base,method,route,body,revision){
  const headers={};if(body!==undefined)headers['Content-Type']='application/json';
  if(revision!==undefined)headers['If-Match']=`"${revision}"`;
  const response=await fetch(base+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();
  assert(response.ok,`${method} ${route}: ${response.status} ${data.error||''}`);
  return data;
}
// Await each HTTP result before checking it. An async browser predicate returns
// a truthy Promise before the requested state has necessarily been saved.
async function waitForAPI(base,route,predicate){
  const deadline=Date.now()+15000;
  do{
    if(predicate(await api(base,'GET',route)))return;
    await delay(50);
  }while(Date.now()<deadline);
  assert.fail(`Timed out waiting for saved state at ${route}`);
}

test('Web UI and Agent API share one live knowledge base', {timeout:90000,skip:!localSample}, async t=>{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'smg-sync-'));
  const database=path.join(temporary,'knowledge.json');
  const port=await freePort();
  const {base,child}=await startServer(port,database);
  const browser=await chromium.launch({headless:true,executablePath});
  t.after(async()=>{await browser.close();await stopServer(child);await fs.rm(temporary,{recursive:true,force:true});});
  const page=await browser.newPage({viewport:{width:1600,height:1000}});
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  const initial=await api(base,'GET','/api/knowledge');
  const paperCount=initial.manifest.papers.length;
  assert(paperCount>=18);

  await page.goto(base);await page.locator('#papers .paper-row').first().waitFor();
  await page.locator('#knowledge-open').waitFor({state:'visible'});
  await page.locator('#select-all-papers').check();
  await waitForAPI(base,'/api/knowledge/state',data=>data.state.selected_paper_ids.length===paperCount);
  assert.equal(await page.locator('#paper-count').innerText(),`${paperCount} / ${paperCount}`);
  await page.reload();await page.locator('#papers .paper-row').first().waitFor();
  assert.equal(await page.locator('#select-all-papers').isChecked(),true);

  const tagId=`integration-tag-${crypto.randomUUID().slice(0,8)}`;
  const groupId=`integration-group-${crypto.randomUUID().slice(0,8)}`;
  const snapshot=await api(base,'GET','/api/knowledge');
  await api(base,'POST','/api/knowledge/batch',{
    expected_revision:snapshot.revision,
    operations:[
      {op:'create',resource:'tags',value:{id:tagId,label:'Agent 同步标签'}},
      {op:'create',resource:'groups',value:{id:groupId,name:'Agent 同步分组',paper_ids:['qwen-image-2.0']}}
    ]
  });
  // These options are populated by the open page after the API's SSE revision event.
  await page.locator(`#tag-filter option[value="${tagId}"]`).waitFor({state:'attached',timeout:15000});
  await page.locator(`#group-picker option[value="${groupId}"]`).waitFor({state:'attached',timeout:15000});
  await page.locator('#group-picker').selectOption(groupId);
  await waitForAPI(base,'/api/knowledge/state',data=>
    data.state.active_group_id===groupId&&data.state.selected_paper_ids.join(',')==='qwen-image-2.0');
  assert.equal(await page.locator('#paper-count').innerText(),`1 / ${paperCount}`);

  const newPaperId=`integration-paper-${crypto.randomUUID().slice(0,8)}`;
  const addPaperAt=await api(base,'GET','/api/knowledge');
  await api(base,'POST','/api/knowledge/batch',{
    expected_revision:addPaperAt.revision,operations:[
      {op:'create',resource:'papers',value:{paper_id:newPaperId,verified_title:'Agent 新收录论文',version_id:'test-v1',pdf:{status:'missing'}}},
      {op:'create',resource:'entities',value:{id:`paper-${newPaperId}`,label:'Agent 新收录论文',kind:'paper',paper_ids:[newPaperId],source_ids:[]}}
    ]
  });
  await page.locator('#papers .paper-row').filter({hasText:'Agent 新收录论文'}).waitFor({timeout:15000});
  assert.equal(await page.locator('#paper-count').innerText(),`1 / ${paperCount+1}`);
  const renameAt=await api(base,'GET','/api/knowledge');
  await api(base,'PATCH','/api/knowledge/papers/qwen-image-2.0',{
    verified_title:'Qwen-Image-2.0 · Agent 更正标题'
  },renameAt.revision);
  await page.locator('#papers .paper-row').filter({hasText:'Qwen-Image-2.0 · Agent 更正标题'}).waitFor({timeout:15000});

  await page.locator('[data-view="paper"]').click();
  await page.locator('#node-picker').selectOption({label:'SwiGLU'});
  await page.locator('#annotation-panel').waitFor({state:'visible'});
  await page.locator('#annotation-summary').click();
  await page.locator('#tag-picker').selectOption(tagId);
  await page.locator('#tag-add').click();
  await waitForAPI(base,'/api/knowledge/entities/swiglu',data=>data.item?.tag_ids?.includes(tagId));

  const humanNote=`Web UI note ${crypto.randomUUID()}`;
  await page.locator('#note-input').fill(humanNote);
  await page.locator('#note-add').click();
  await waitForAPI(base,'/api/knowledge/notes',data=>
    data.items.some(note=>note.body===humanNote&&note.target_type==='entity'&&note.target_id==='swiglu'));
  const notes=(await api(base,'GET','/api/knowledge/notes')).items;
  assert(notes.some(note=>note.body===humanNote));

  const agentNote=`Agent note ${crypto.randomUUID()}`;
  await api(base,'POST','/api/knowledge/notes',{
    id:`integration-note-${crypto.randomUUID()}`,target_type:'entity',target_id:'swiglu',body:agentNote
  });
  await page.locator('#note-list').getByText(agentNote).waitFor({timeout:15000});

  await page.locator('#knowledge-open').click();
  await page.locator('#knowledge-resource').selectOption('entities');
  await page.locator('#knowledge-record').selectOption('swiglu');
  const draft=JSON.parse(await page.locator('#knowledge-json').inputValue());
  await page.locator('#knowledge-json').fill(JSON.stringify({...draft,description:'Unsaved human draft'},null,2));
  const latest=await api(base,'GET','/api/knowledge');
  await api(base,'PATCH','/api/knowledge/entities/swiglu',{description:'Agent won the concurrent edit'},latest.revision);
  await page.getByText(/知识库已更新至版本/).waitFor({timeout:15000});
  assert.match(await page.locator('#knowledge-json').inputValue(),/Unsaved human draft/);
  await page.locator('#knowledge-save').click();
  await page.getByText(/保存失败：Revision changed/).waitFor({timeout:10000});
  const afterConflict=await api(base,'GET','/api/knowledge/entities/swiglu');
  assert.equal(afterConflict.item.description,'Agent won the concurrent edit');

  const webTagId=`web-tag-${crypto.randomUUID().slice(0,8)}`;
  await page.locator('#knowledge-resource').selectOption('tags');
  await page.locator('#knowledge-json').fill(JSON.stringify({id:webTagId,label:'网页新增标签'},null,2));
  await page.locator('#knowledge-save').click();
  await page.getByText(new RegExp(`已保存 ${webTagId}`)).waitFor({timeout:10000});
  assert.equal((await api(base,'GET',`/api/knowledge/tags/${webTagId}`)).item.label,'网页新增标签');
  assert.deepEqual(pageErrors,[]);
});
