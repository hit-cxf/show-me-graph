import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const dir=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.SMG_PORT||4317);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid SMG_PORT');
const url=`http://127.0.0.1:${port}`;
const runtime=path.join(dir,'.runtime');
const pidFile=path.join(runtime,`server-${port}.json`);
const logFile=path.join(runtime,`server-${port}.log`);
async function health(){
  try{const r=await fetch(`${url}/api/health`,{signal:AbortSignal.timeout(1000)});return r.ok?await r.json():null;}catch{return null;}
}
async function record(){try{return JSON.parse(await fs.readFile(pidFile,'utf8'));}catch{return null;}}
const action=process.argv[2]||'status';
const current=await health();
if(action==='status'){
  if(current?.app==='show-me-graph')console.log(`Running: ${url} (PID ${current.pid})`);
  else{console.log(`Stopped: ${url}`);process.exitCode=1;}
}else if(action==='start'){
  if(current?.app==='show-me-graph'){
    console.log(`Already running: ${url} (PID ${current.pid})`);
  }else{
    if(current)throw new Error(`Port ${port} is occupied by another HTTP service`);
    await fs.access(path.join(dir,'dist/index.html'));
    await fs.mkdir(runtime,{recursive:true});
    const log=await fs.open(logFile,'a');
    const child=spawn(process.execPath,[path.join(dir,'server.mjs')],{cwd:dir,detached:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,SMG_PORT:String(port)}});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    child.unref();await log.close();
    await fs.writeFile(pidFile,JSON.stringify({pid:child.pid,port,startedAt:new Date().toISOString()})+'\n');
    let ready=false;
    for(let i=0;i<40;i++){
      const state=await health();
      if(state?.app==='show-me-graph'&&state.pid===child.pid){ready=true;break;}
      if(child.exitCode!==null)break;
      await delay(150);
    }
    if(!ready)throw new Error(`Server did not become ready; see ${logFile}`);
    console.log(`Running in background: ${url} (PID ${child.pid})\nLog: ${logFile}\nStop with: npm stop`);
  }
}else if(action==='stop'){
  const stored=await record();
  if(!current){console.log(`Already stopped: ${url}`);}
  else{
    if(current.app!=='show-me-graph'||!stored||stored.pid!==current.pid)throw new Error('No matching managed process; refusing to stop another service');
    process.kill(stored.pid,'SIGTERM');
    let stopped=false;
    for(let i=0;i<30;i++){if(!await health()){stopped=true;break;}await delay(100);}
    if(!stopped)throw new Error('Server did not stop');
    await fs.rm(pidFile,{force:true});console.log(`Stopped: ${url}`);
  }
}else{throw new Error('Usage: node service.mjs start|stop|status');}
