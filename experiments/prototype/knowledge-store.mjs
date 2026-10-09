import fs from 'node:fs/promises';
import path from 'node:path';
import {EventEmitter} from 'node:events';

const resources={
  papers:['manifest','papers','paper_id'],
  entities:['graph','entities','id'],
  relations:['graph','relations','id'],
  evidence:['evidence','evidence','id'],
  notes:[null,'notes','id'],
  tags:[null,'tags','id'],
  groups:[null,'groups','id'],
  conflicts:['graph','conflicts','id'],
  negative_examples:['graph','negative_examples','id']
};

export class KnowledgeError extends Error {
  constructor(status,code,message){super(message);this.name='KnowledgeError';this.status=status;this.code=code;}
}

const bad=(message)=>{throw new KnowledgeError(400,'validation_error',message);};
const conflict=(message)=>{throw new KnowledgeError(409,'conflict',message);};
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const nonempty=value=>typeof value==='string'&&value.trim().length>0;
const uniqueList=(value,name)=>{
  if(!Array.isArray(value)||value.some(x=>!nonempty(x))||new Set(value).size!==value.length)bad(`${name} must be an array of unique nonempty strings`);
};
const collection=(data,resource)=>{
  const spec=resources[resource];
  if(!spec)bad(`Unknown resource: ${resource}`);
  return spec[0]?data[spec[0]][spec[1]]:data[spec[1]];
};
const keyFor=resource=>resources[resource]?.[2];
const indexOf=(data,resource,id)=>collection(data,resource).findIndex(item=>item[keyFor(resource)]===id);

function validatePreferences(preferences){
  if(!isObject(preferences))bad('Preferences must be an object');
  for(const key of Object.keys(preferences))if(key!=='maintenance_prompt')bad(`Unknown preferences field: ${key}`);
  if(typeof preferences.maintenance_prompt!=='string')bad('preferences.maintenance_prompt must be a string');
  if(preferences.maintenance_prompt.length>20000)bad('preferences.maintenance_prompt must not exceed 20000 characters');
}

function enrich(item,resource,actor,previous){
  if(!['entities','relations','evidence','papers','conflicts','negative_examples'].includes(resource))return item;
  const now=new Date().toISOString();
  const old=previous?.provenance||{};
  const provided=isObject(item.provenance)?item.provenance:{};
  const hasLinkedEvidence=(Array.isArray(item.source_ids)&&item.source_ids.length>0)||
    (resource==='evidence'&&!!item.paper_id&&!!item.sha256)||
    (resource==='papers'&&!!item.pdf?.sha256);
  const provenance={
    ...old,...provided,
    origin:old.origin||actor,
    review_status:provided.review_status||old.review_status||'unreviewed',
    evidence_status:hasLinkedEvidence?'linked':'unlinked',
    created_at:old.created_at||now,
    updated_at:now
  };
  if(resource==='relations')provenance.inference_status=item.basis==='explicit'?'source_explicit':'ai_inferred';
  return {...item,provenance};
}

function validate(data){
  if(!isObject(data)||!isObject(data.manifest)||!isObject(data.graph)||!isObject(data.evidence))bad('Invalid knowledge database root');
  validatePreferences(data.preferences);
  for(const [resource,spec] of Object.entries(resources)){
    const list=collection(data,resource);
    if(!Array.isArray(list))bad(`${resource} must be an array`);
    const ids=new Set();
    for(const item of list){
      if(!isObject(item)||!nonempty(item[spec[2]]))bad(`${resource} record requires ${spec[2]}`);
      if(ids.has(item[spec[2]]))conflict(`Duplicate ${resource} id: ${item[spec[2]]}`);
      ids.add(item[spec[2]]);
    }
  }
  const ids=resource=>new Set(collection(data,resource).map(x=>x[keyFor(resource)]));
  const papers=ids('papers'),entities=ids('entities'),evidence=ids('evidence'),tags=ids('tags'),groups=ids('groups'),relations=ids('relations');
  for(const paper of data.manifest.papers){
    if(!nonempty(paper.verified_title||paper.expected_title))bad(`Paper ${paper.paper_id} requires a title`);
    if(paper.tag_ids!==undefined){uniqueList(paper.tag_ids,`paper ${paper.paper_id}.tag_ids`);for(const id of paper.tag_ids)if(!tags.has(id))bad(`Unknown tag ${id}`);}
  }
  for(const item of data.graph.entities){
    if(!nonempty(item.label)||!nonempty(item.kind))bad(`Entity ${item.id} requires label and kind`);
    uniqueList(item.paper_ids,`entity ${item.id}.paper_ids`);
    for(const id of item.paper_ids)if(!papers.has(id))bad(`Entity ${item.id} references unknown paper ${id}`);
    if(item.kind==='paper'&&item.paper_ids.length!==1)bad(`Paper entity ${item.id} must link exactly one paper`);
  }
  for(const item of data.graph.relations){
    if(!entities.has(item.source)||!entities.has(item.target))bad(`Relation ${item.id} has unknown endpoint`);
    if(!nonempty(item.type))bad(`Relation ${item.id} requires type`);
  }
  for(const item of data.evidence.evidence){
    if(!papers.has(item.paper_id))bad(`Evidence ${item.id} references unknown paper ${item.paper_id}`);
    const paper=data.manifest.papers.find(p=>p.paper_id===item.paper_id);
    if(item.sha256&&paper.pdf?.sha256&&item.sha256!==paper.pdf.sha256)bad(`Evidence ${item.id} PDF hash differs from paper`);
    if(item.page!==undefined&&(!Number.isInteger(item.page)||item.page<1))bad(`Evidence ${item.id} requires positive page number`);
  }
  for(const resource of ['entities','relations','conflicts','negative_examples']){
    for(const item of collection(data,resource)){
      if(item.source_ids!==undefined){uniqueList(item.source_ids,`${resource} ${item.id}.source_ids`);for(const id of item.source_ids)if(!evidence.has(id))bad(`${resource} ${item.id} references unknown evidence ${id}`);}
      if(item.tag_ids!==undefined){uniqueList(item.tag_ids,`${resource} ${item.id}.tag_ids`);for(const id of item.tag_ids)if(!tags.has(id))bad(`${resource} ${item.id} references unknown tag ${id}`);}
    }
  }
  for(const item of data.graph.conflicts)if(item.subject!==undefined&&!entities.has(item.subject))bad(`Conflict ${item.id} references unknown entity`);
  for(const item of data.graph.negative_examples)if(!entities.has(item.source)||!entities.has(item.target))bad(`Negative example ${item.id} has unknown endpoint`);
  for(const item of data.notes){
    if(!nonempty(item.body))bad(`Note ${item.id} requires body`);
    if(!['paper','entity','relation','evidence'].includes(item.target_type))bad(`Note ${item.id} has invalid target_type`);
    const target={paper:papers,entity:entities,relation:relations,evidence}[item.target_type];
    if(!target.has(item.target_id))bad(`Note ${item.id} references unknown ${item.target_type} ${item.target_id}`);
  }
  for(const item of data.tags)if(!nonempty(item.label))bad(`Tag ${item.id} requires label`);
  for(const item of data.groups){
    if(!nonempty(item.name))bad(`Group ${item.id} requires name`);
    uniqueList(item.paper_ids,`group ${item.id}.paper_ids`);
    for(const id of item.paper_ids)if(!papers.has(id))bad(`Group ${item.id} references unknown paper ${id}`);
  }
  if(!isObject(data.state))bad('state must be an object');
  uniqueList(data.state.selected_paper_ids,'state.selected_paper_ids');
  for(const id of data.state.selected_paper_ids)if(!papers.has(id))bad(`State references unknown paper ${id}`);
  if(data.state.active_group_id!==null&&!groups.has(data.state.active_group_id))bad('State references unknown group');
}

function apply(data,{op,resource,id,value},actor){
  if(!resources[resource])bad(`Unknown resource: ${resource}`);
  const list=collection(data,resource),key=keyFor(resource);
  if(op==='create'){
    if(!isObject(value)||!nonempty(value[key]))bad(`Create ${resource} requires ${key}`);
    if(indexOf(data,resource,value[key])!==-1)conflict(`${resource} ${value[key]} already exists`);
    const item=enrich(structuredClone(value),resource,actor);
    list.push(item);return item;
  }
  if(!nonempty(id))bad(`${op} ${resource} requires id`);
  const index=indexOf(data,resource,id);
  if(index<0)throw new KnowledgeError(404,'not_found',`${resource} ${id} not found`);
  if(op==='delete'){
    list.splice(index,1);return {deleted:id};
  }
  if(op==='patch'){
    if(!isObject(value))bad(`Patch ${resource} requires an object`);
    if(value[key]!==undefined&&value[key]!==id)bad(`${key} cannot be changed`);
    const previous=list[index];
    const merged={...previous,...structuredClone(value)};
    if(isObject(value.provenance))merged.provenance={...previous.provenance,...value.provenance};
    const item=enrich(merged,resource,actor,previous);
    list[index]=item;return item;
  }
  bad(`Unknown operation: ${op}`);
}

export class KnowledgeStore extends EventEmitter {
  #data;
  #file;
  #pending=Promise.resolve();
  constructor(file,data){super();this.#file=file;this.#data=data;}
  static async open({file,corpus}){
    let data;
    try{data=JSON.parse(await fs.readFile(file,'utf8'));}
    catch(error){
      if(error.code!=='ENOENT')throw error;
      const read=async name=>JSON.parse(await fs.readFile(path.join(corpus,name),'utf8'));
      let hasCorpus=true;
      try{await fs.access(path.join(corpus,'manifest.json'));}
      catch(seedError){if(seedError.code!=='ENOENT')throw seedError;hasCorpus=false;}
      if(hasCorpus){
        const [manifest,graph,evidence]=await Promise.all(['manifest.json','propositions.json','evidence.json'].map(read));
        const initialSelection=['qwen-image-2.0','qwen-image','sd3','dc-ae','qwen-image-vae-2.0','qwen2-rl-report']
          .filter(id=>manifest.papers.some(p=>p.paper_id===id));
        data={schema_version:'1.0',revision:0,updated_at:new Date().toISOString(),manifest,graph,evidence,
          notes:[],tags:[],groups:[],preferences:{maintenance_prompt:''},state:{selected_paper_ids:initialSelection,active_group_id:null}};
        for(const resource of ['papers','entities','relations','evidence','conflicts','negative_examples']){
          const list=collection(data,resource);
          list.forEach((item,index)=>{list[index]=enrich(item,resource,'agent');});
        }
      }else{
        // A source checkout contains code only. Each user starts with their own
        // local database; an existing database is always read above as-is.
        data={schema_version:'1.0',revision:0,updated_at:new Date().toISOString(),
          manifest:{schema_version:'0.1',papers:[]},
          graph:{schema_version:'0.1',entities:[],relations:[],conflicts:[],negative_examples:[],notes:[]},
          evidence:{schema_version:'0.1',evidence:[]},
          notes:[],tags:[],groups:[],preferences:{maintenance_prompt:''},
          state:{selected_paper_ids:[],active_group_id:null}};
      }
      validate(data);
      await KnowledgeStore.save(file,data);
    }
    // Supply the additive field in memory; persist it with the next actual mutation.
    if(data.preferences===undefined)data.preferences={maintenance_prompt:''};
    validate(data);
    if(!Number.isInteger(data.revision)||data.revision<0)bad('Invalid revision');
    return new KnowledgeStore(file,data);
  }
  static async save(file,data){
    await fs.mkdir(path.dirname(file),{recursive:true});
    const temp=`${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    try{
      const handle=await fs.open(temp,'wx',0o600);
      try{await handle.writeFile(JSON.stringify(data,null,2)+'\n');await handle.sync();}finally{await handle.close();}
      await fs.rename(temp,file);
    }catch(error){await fs.rm(temp,{force:true});throw error;}
  }
  snapshot(){return structuredClone(this.#data);}
  list(resource){return {revision:this.#data.revision,items:structuredClone(collection(this.#data,resource))};}
  get(resource,id){
    if(!resources[resource])bad(`Unknown resource: ${resource}`);
    const item=collection(this.#data,resource).find(x=>x[keyFor(resource)]===id);
    if(!item)throw new KnowledgeError(404,'not_found',`${resource} ${id} not found`);
    return {revision:this.#data.revision,item:structuredClone(item)};
  }
  async #mutate(change,expectedRevision){
    const task=this.#pending.catch(()=>{}).then(async()=>{
      if(expectedRevision!==undefined&&expectedRevision!==this.#data.revision)conflict(`Revision changed; current revision is ${this.#data.revision}`);
      const next=structuredClone(this.#data);
      const result=change(next);
      validate(next);
      next.revision++;
      next.updated_at=new Date().toISOString();
      await KnowledgeStore.save(this.#file,next);
      this.#data=next;
      this.emit('revision',next.revision);
      return {revision:next.revision,...result};
    });
    this.#pending=task;
    return task;
  }
  async operate(operation,{actor='agent',expectedRevision}={}){
    return this.#mutate(data=>{
      const result=apply(data,operation,actor);
      return operation.op==='delete'?result:{item:result};
    },expectedRevision);
  }
  async batch(operations,{actor='agent',expectedRevision}={}){
    if(!Array.isArray(operations)||!operations.length||operations.length>1000)bad('Batch requires 1 to 1000 operations');
    return this.#mutate(data=>({results:operations.map(operation=>apply(data,operation,actor))}),expectedRevision);
  }
  async setState(update,{expectedRevision}={}){
    if(!isObject(update))bad('State must be an object');
    const allowed=['selected_paper_ids','active_group_id'];
    for(const key of Object.keys(update))if(!allowed.includes(key))bad(`Unknown state field: ${key}`);
    return this.#mutate(data=>{data.state={...data.state,...structuredClone(update)};return {state:data.state};},expectedRevision);
  }
  async setPreferences(preferences,{expectedRevision}={}){
    validatePreferences(preferences);
    return this.#mutate(data=>{
      data.preferences=structuredClone(preferences);
      return {preferences:data.preferences};
    },expectedRevision);
  }
}

export const KNOWLEDGE_RESOURCES=Object.freeze(Object.keys(resources));
