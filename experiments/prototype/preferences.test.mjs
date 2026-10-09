import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn, execFile} from 'node:child_process';
import {once} from 'node:events';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const dir=path.dirname(fileURLToPath(import.meta.url));
const localSample=await fs.access(path.resolve(dir,'../corpus/manifest.json')).then(()=>true,()=>false);
const executablePath=process.env.SMG_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const execFileAsync=promisify(execFile);

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

test('Knowledge maintenance preferences persist and sync without overwriting human drafts', {timeout:90000,skip:!localSample}, async t=>{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'smg-preferences-'));
  const database=path.join(temporary,'knowledge.json');
  let child,browser;
  t.after(async()=>{await browser?.close();await stopServer(child);await fs.rm(temporary,{recursive:true,force:true});});
  const server=await startServer(await freePort(),database);
  child=server.child;
  const {base}=server;
  browser=await chromium.launch({headless:true,executablePath});
  const page=await browser.newPage({viewport:{width:1600,height:1000}});
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  const prompt=page.locator('#preferences-prompt');
  const message=page.locator('#preferences-message');
  const waitForPrompt=value=>page.waitForFunction(expected=>document.querySelector('#preferences-prompt')?.value===expected,value);
  const save=async(value,status=200)=>{
    await prompt.fill(value);
    const saved=page.waitForResponse(response=>response.url()===`${base}/api/knowledge/preferences`&&response.request().method()==='PUT');
    await page.locator('#preferences-save').click();
    assert.equal((await saved).status(),status);
    await page.waitForFunction(failed=>{
      const text=document.querySelector('#preferences-message')?.textContent||'';
      return failed?text.includes('保存失败'):text.includes('已保存');
    },status!==200);
  };

  assert.deepEqual((await api(base,'GET','/api/knowledge/preferences')).preferences,{maintenance_prompt:''});
  await page.goto(base);await page.locator('#papers .paper-row').first().waitFor();
  await page.locator('#preferences-open').click();
  await page.locator('#preferences-dialog').waitFor({state:'visible'});
  assert.equal(await prompt.inputValue(),'');

  const humanPreference='优先阅读原始论文，解释压缩率时明确空间与通道维度。\n用中文记录，并保留方法的英文名称。';
  await save(humanPreference);
  assert.equal(await page.locator('#preferences-dialog').isVisible(),true);
  const stored=await api(base,'GET','/api/knowledge/preferences');
  assert.equal(stored.preferences.maintenance_prompt,humanPreference);
  assert.deepEqual((await api(base,'GET','/api/knowledge')).preferences,stored.preferences);
  const cli=path.resolve(dir,'../../skills/show-me-graph/scripts/smg.py');
  const {stdout}=await execFileAsync('python3',[cli,'--base',base,'get-preferences']);
  assert.deepEqual(JSON.parse(stdout).preferences,stored.preferences);

  await page.reload();await page.locator('#papers .paper-row').first().waitFor();
  await page.locator('#preferences-open').click();
  await waitForPrompt(humanPreference);

  // An open, clean editor follows an Agent write through the same revision stream.
  const agentPreference='Agent 更新：关注 VAE、训练课程和蒸馏之间的关系。';
  const beforeAgent=await api(base,'GET','/api/knowledge/preferences');
  await api(base,'PUT','/api/knowledge/preferences',{maintenance_prompt:agentPreference},beforeAgent.revision);
  await waitForPrompt(agentPreference);

  // An unsaved draft must remain intact, even when the dialog is closed and reopened.
  const draft='尚未保存的本地草稿：同时记录负面实验。';
  await prompt.fill(draft);
  await page.locator('#preferences-close').click();
  await page.locator('#preferences-open').click();
  assert.equal(await prompt.inputValue(),draft);
  const newestPreference='其他 Agent 已保存：每条学术关系都附原文证据。';
  const beforeConflict=await api(base,'GET','/api/knowledge/preferences');
  await api(base,'PUT','/api/knowledge/preferences',{maintenance_prompt:newestPreference},beforeConflict.revision);
  await page.waitForFunction(()=>/草稿|偏好已更新/.test(document.querySelector('#preferences-message')?.textContent||''));
  assert.equal(await prompt.inputValue(),draft);
  await save(draft,409);
  assert.match(await message.innerText(),/保存失败/);
  assert.equal((await api(base,'GET','/api/knowledge/preferences')).preferences.maintenance_prompt,newestPreference);

  await page.locator('#preferences-reload').click();
  await waitForPrompt(newestPreference);
  await save('');
  assert.equal((await api(base,'GET','/api/knowledge/preferences')).preferences.maintenance_prompt,'');
  assert.equal((await api(base,'GET','/api/knowledge')).preferences.maintenance_prompt,'');
  await page.reload();await page.locator('#papers .paper-row').first().waitFor();
  await page.locator('#preferences-open').click();
  assert.equal(await prompt.inputValue(),'');
  assert.deepEqual(pageErrors,[]);
});
