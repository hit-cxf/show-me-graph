const resources={
  papers:'论文',entities:'系统 / 方法 / 结论节点',relations:'关系',evidence:'原文证据',
  notes:'备注',tags:'标签',groups:'论文分组',conflicts:'争议',negative_examples:'反例',
};
const keyOf=(resource,item)=>resource==='papers'?item.paper_id:item.id;
const itemsOf=(snapshot,resource)=>{
  if(resource==='papers')return snapshot.manifest?.papers||[];
  if(resource==='entities')return snapshot.graph?.entities||[];
  if(resource==='relations')return snapshot.graph?.relations||[];
  if(resource==='conflicts'||resource==='negative_examples')return snapshot.graph?.[resource]||[];
  if(resource==='evidence')return snapshot.evidence?.evidence||[];
  return snapshot[resource]||[];
};
const labelOf=(resource,item)=>item.label||item.verified_title||item.title||item.name||item.body||item.description||keyOf(resource,item);
const draftFor=resource=>{
  const id=`manual-${crypto.randomUUID().slice(0,8)}`;
  return {
    papers:{paper_id:id,verified_title:'',arxiv_id:'',version_id:'',citation_date:'',pdf:{status:'missing'},tag_ids:[]},
    entities:{id,label:'',kind:'method',paper_ids:[],source_ids:[],description:'',tag_ids:[]},
    relations:{id,source:'',target:'',type:'uses',label:'',basis:'inferred',source_ids:[],description:''},
    evidence:{id,paper_id:'',artifact_path:'',sha256:'',page:1,width:0,height:0,title:'',section:'',quote:'',bboxes:[]},
    notes:{id,target_type:'entity',target_id:'',body:''},
    tags:{id,label:'',color:''},
    groups:{id,name:'',paper_ids:[]},
    conflicts:{id,label:'',description:'',entity_ids:[],relation_ids:[],source_ids:[]},
    negative_examples:{id,label:'',description:'',source_ids:[]},
  }[resource];
};

export function setupKnowledgeEditor({onChanged}){
  const $=id=>document.getElementById(id);
  const dialog=$('knowledge-editor'),resource=$('knowledge-resource'),record=$('knowledge-record');
  const json=$('knowledge-json'),message=$('knowledge-message');
  let snapshot=null,editingId=null,editRevision=null,dirty=false,busy=false;
  for(const [name,label] of Object.entries(resources))resource.add(new Option(label,name));
  const report=text=>{message.textContent=text;};
  const updateButtons=()=>{
    $('knowledge-save').disabled=busy||!snapshot;
    $('knowledge-delete').disabled=busy||!snapshot||!editingId;
    $('knowledge-new').disabled=busy||!snapshot;
  };
  const populate=preferred=>{
    const name=resource.value,items=itemsOf(snapshot,name);
    record.replaceChildren(new Option('选择现有记录…',''));
    for(const item of items){const id=keyOf(name,item);if(!id)continue;record.add(new Option(`${String(labelOf(name,item)).slice(0,90)} · ${id}`,id));}
    if(preferred&&items.some(item=>keyOf(name,item)===preferred))record.value=preferred;
  };
  const loadExisting=id=>{
    const item=itemsOf(snapshot,resource.value).find(row=>keyOf(resource.value,row)===id);
    if(!item){editingId=null;report('记录不存在或已被删除。');updateButtons();return;}
    editingId=id;editRevision=snapshot.revision;dirty=false;record.value=id;
    json.value=JSON.stringify(item,null,2);report(`正在编辑 ${id} · 知识库版本 ${editRevision}`);updateButtons();
  };
  const newRecord=()=>{
    editingId=null;editRevision=snapshot?.revision;dirty=false;record.value='';
    json.value=JSON.stringify(draftFor(resource.value),null,2);
    report('新建记录：请补全必填字段和证据，保存后会直接进入共享知识库。');updateButtons();
  };
  const refresh=next=>{
    const previousRevision=snapshot?.revision;snapshot=next;
    const prior=editingId;populate(prior);
    if(dialog.open&&dirty&&previousRevision!==undefined&&previousRevision!==next.revision){
      report(`知识库已更新至版本 ${next.revision}。当前草稿仍保留；保存前请核对并处理版本冲突。`);
    }else if(dialog.open&&prior&&!dirty)loadExisting(prior);
    updateButtons();
  };
  const open=(type='entities',id)=>{
    if(!snapshot){report('知识库正在载入，请稍后再试。');return;}
    resource.value=resources[type]?type:'entities';populate(id);
    if(id)loadExisting(id);else newRecord();
    if(!dialog.open)dialog.showModal();
  };
  async function request(path,method,body){
    const response=await fetch(`/api/knowledge/${path}`,{
      method,headers:{'Content-Type':'application/json','If-Match':`"${editRevision}"`,'X-SMG-Actor':'human'},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);
    return data;
  }
  $('knowledge-open').onclick=()=>open();
  $('knowledge-close').onclick=()=>dialog.close();
  resource.onchange=()=>{populate();newRecord();};
  record.onchange=()=>record.value?loadExisting(record.value):newRecord();
  json.oninput=()=>{dirty=true;};
  $('knowledge-new').onclick=newRecord;
  $('knowledge-save').onclick=async()=>{
    if(busy||!snapshot)return;
    let value;try{value=JSON.parse(json.value);}catch(error){report(`JSON 格式错误：${error.message}`);return;}
    const name=resource.value;busy=true;updateButtons();report('正在保存并核对共享知识库…');
    try{
      const result=await request(editingId?`${name}/${encodeURIComponent(editingId)}`:name,editingId?'PATCH':'POST',value);
      const savedId=keyOf(name,result.item)||editingId;dirty=false;
      await onChanged();
      populate(savedId);loadExisting(savedId);report(`已保存 ${savedId} · 知识库版本 ${result.revision}`);
    }catch(error){report(`保存失败：${error.message}`);}finally{busy=false;updateButtons();}
  };
  $('knowledge-delete').onclick=async()=>{
    if(busy||!editingId||!snapshot)return;
    const id=editingId,name=resource.value;
    if(!window.confirm(`确定删除 ${resources[name]}「${id}」？有关联的记录可能需要先处理。`))return;
    busy=true;updateButtons();report('正在删除并核对共享知识库…');
    try{const result=await request(`${name}/${encodeURIComponent(id)}`,'DELETE');dirty=false;editingId=null;await onChanged();populate();newRecord();report(`已删除 ${id} · 知识库版本 ${result.revision}`);}
    catch(error){report(`删除失败：${error.message}`);}finally{busy=false;updateButtons();}
  };
  updateButtons();
  return {open,refresh};
}
