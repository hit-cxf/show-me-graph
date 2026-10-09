import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import './style.css';
import './ui.js';
import {layoutPapers} from './paper-layout.js';
import {layoutTechnical,technicalRelationRole} from './technical-layout.js';
import {relationOccurrencePairs,entityOrigins,layoutWarningText} from './relation-view.js';
import {setupViewportNavigation} from './viewport-navigation.js';
import {setupSceneLegend} from './scene-legend.js';
import {setupKnowledgeEditor} from './knowledge-editor.js';
import {setupPreferencesEditor} from './preferences-editor.js';
import {createNodeVisual,createLinkVisual,updateLinkVisual} from './graph-visuals.js';
pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
const $=id=>document.getElementById(id);
setupSceneLegend();
const fetchJSON=async url=>{const r=await fetch(url);const data=await r.json();if(!r.ok)throw new Error(data.error||r.statusText);return data;};
let knowledge=await fetchJSON('/api/knowledge');
let manifest=knowledge.manifest,propositions=knowledge.graph,evidenceData=knowledge.evidence;
let papers=manifest.papers,entities=propositions.entities,relations=propositions.relations;
let notes=knowledge.notes||[],tags=knowledge.tags||[],groups=knowledge.groups||[],sharedState=knowledge.state||{};
const evidence=new Map(evidenceData.evidence.map(e=>[e.id,e]));
const coreIds=['qwen-image-2.0','qwen-image','sd3','dc-ae','qwen-image-vae-2.0','qwen2-rl-report'];
const selected=new Set((sharedState.selected_paper_ids||coreIds).filter(id=>papers.some(p=>p.paper_id===id)));
$('corpus-badge').textContent=`知识库 · ${papers.length} 篇论文`;
let view='space', focus=selected.has('qwen-image-2.0')?'qwen-image-2.0':selected.values().next().value||papers[0]?.paper_id, categoryFilter='', sequence=0, planes=[],activePDFRender=null, inspectedKey=null,inspectedItem=null,knowledgeEditor=null,preferencesEditor=null;
let relationScope=null;
const relationRoleNames={containment:'组成与阶段',dependency:'采用与依赖',sequence:'先后顺序',feedback:'回流与迭代',rationale:'动机、结论与限定',reference:'文献与技术来源',association:'其他关联'};
const pdfCache=new Map();
const status=msg=>$('status').textContent=msg;
let pendingSelections=0,stateWrites=Promise.resolve(),refreshPromise=null,refreshAgain=false,annotationKey=null;
async function apiWrite(path,method,body,revision){
 const response=await fetch(`/api/knowledge/${path}`,{method,headers:{'Content-Type':'application/json','X-SMG-Actor':'human',...(revision===undefined?{}:{'If-Match':`"${revision}"`})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const result=await response.json();if(!response.ok)throw new Error(result.error||response.statusText);return result;
}
const shortTitle=p=>p.short_title||(p.verified_title&&p.verified_title!==p.expected_title?p.verified_title:null)||({'qwen-image-2.0':'Qwen-Image-2.0','qwen-image':'Qwen-Image','qwen-image-vae-2.0':'Qwen-Image-2.0 VAE','qwen2-rl-report':'Qwen-Image-2.0 RL','qwen3-vl':'Qwen3-VL','sd3':'Stable Diffusion 3','dc-ae':'DC-AE','mean-flows':'MeanFlow','ldm':'Latent Diffusion','glu-variants':'GLU Variants','reconstruction-vs-generation':'Reconstruction vs. Generation'}[p.paper_id]||p.verified_title||p.title||p.expected_title||p.paper_id);
const themeColor=(name,fallback)=>getComputedStyle(document.documentElement).getPropertyValue(`--graph-${name}`).trim()||fallback;
function readPalette(){return {bg:themeColor('bg','#f4f7fa'),paper:themeColor('paper','#5262b0'),method:themeColor('method','#187c73'),claim:themeColor('claim','#a36a1b'),dependency:themeColor('dependency','#3979b2'),sequence:themeColor('sequence','#9161b9'),link:themeColor('link','#6c8194'),muted:themeColor('muted-link','#9eb0ba'),conflict:themeColor('conflict','#b8673d'),plane:themeColor('plane','#c6dce4'),grid:themeColor('grid','#9ab3c2')};}
let palette=readPalette();
const color=n=>n.kind==='paper'?palette.paper:/claim|definition|finding|result|observation/.test(n.kind)?palette.claim:palette.method;
// A presentation-only density setting; node sizes and research records stay fixed.
const nodeSpacingScale=.7;
const graph=new ForceGraph3D($('graph'),{controlType:'orbit'}).backgroundColor(palette.bg).showNavInfo(false)
 .nodeLabel(n=>`${n.label} · ${n.kind}`)
 .nodeThreeObject(n=>createNodeVisual(n,palette,color(n)))
 .linkWidth(0).linkOpacity(0).linkLabel(link=>link.label||link.type).linkDirectionalArrowLength(0)
 .linkThreeObject(link=>createLinkVisual(link,palette))
 .linkPositionUpdate((object,{start,end},link)=>updateLinkVisual(object,start,end,link))
 .onNodeClick(n=>{if(view==='space'&&n.kind==='paper'){focus=n.paper_id;setView('paper');showPapers();}else focusNode(n);inspect(n);}).onLinkClick(l=>inspect(l)).cooldownTicks(0).enableNodeDrag(false);
const navigation=setupViewportNavigation({camera:graph.camera(),controls:graph.controls(),element:graph.renderer().domElement,
 getNodes:()=>graph.graphData().nodes,
 interruptTransition:()=>{
   // The dependency finishes an old tween before replacing it. Clone the
   // current pose first so a user gesture interrupts it without a visible jump.
   const position=graph.camera().position.clone(),target=graph.controls().target.clone();
   graph.cameraPosition(position,target,0);
 },
});

function showPapers(){
 document.title=papers.length?'Show Me Graph · 图像生成试点':'Show Me Graph';
 document.querySelector('.brand span').textContent=papers.length?'研究脉络 / 图像生成':'研究脉络 / 我的知识库';
 document.querySelector('#library-content details').hidden=!papers.length;
 $('paper-count').textContent=`${selected.size} / ${papers.length}`;$('papers').replaceChildren();
 const all=$('select-all-papers');all.checked=papers.length>0&&selected.size===papers.length;all.indeterminate=selected.size>0&&selected.size<papers.length;
 if(!papers.length)$('papers').textContent='暂无论文。可通过「管理知识库」新增，或让 Agent 使用配套 Skill 导入。';
 for(const p of papers){
   const row=document.createElement('div');row.className='paper-row';const cb=document.createElement('input');cb.type='checkbox';cb.checked=selected.has(p.paper_id);cb.ariaLabel=`显示 ${shortTitle(p)}`;
   cb.onchange=()=>{const next=new Set(selected);cb.checked?next.add(p.paper_id):next.delete(p.paper_id);setPapers([...next]);};
   const button=document.createElement('button');button.className=focus===p.paper_id?'focus':'';button.textContent=shortTitle(p);
   const small=document.createElement('small');small.textContent=`${p.version_id||'版本待补充'} · ${entities.filter(e=>e.kind!=='paper'&&e.paper_ids?.includes(p.paper_id)).length} 个技术节点`;button.append(small);
   button.onclick=()=>{focus=p.paper_id;if(!selected.has(focus))setPapers([...selected,focus]);setView('paper');showPapers();inspect(entities.find(e=>e.id===`paper-${focus}`)||{label:shortTitle(p),kind:'paper',paper_ids:[focus],source_ids:[]});};row.append(cb,button);$('papers').append(row);
 }
}
function showFilters(){
 const previousTag=$('tag-filter').value;
 $('group-picker').replaceChildren(new Option('不使用分组',''));
 groups.forEach(group=>$('group-picker').add(new Option(`${group.name} · ${group.paper_ids.length} 篇`,group.id)));
 $('group-picker').value=sharedState.active_group_id||'';
 $('tag-filter').replaceChildren(new Option('全部标签',''));
 tags.forEach(tag=>$('tag-filter').add(new Option(tag.label,tag.id)));
 if(tags.some(tag=>tag.id===previousTag))$('tag-filter').value=previousTag;
 const categoryNames={data:'数据体系',architecture:'模型架构',training:'训练与蒸馏',evaluation:'评测与结论'};
 $('category-filter').replaceChildren(new Option('全部技术主题',''));
 [...new Set(entities.map(e=>e.category).filter(Boolean))].sort().forEach(category=>$('category-filter').add(new Option(categoryNames[category]||category,category)));
 if([...$('category-filter').options].some(option=>option.value===categoryFilter))$('category-filter').value=categoryFilter;else categoryFilter='';
 showTagResults();
}
function showTagResults(){
 const id=$('tag-filter').value,container=$('tag-results');container.replaceChildren();container.hidden=!id;if(!id)return;
 const matches=[...papers.filter(p=>p.tag_ids?.includes(id)).map(p=>({kind:'paper',record:p})),...entities.filter(e=>e.tag_ids?.includes(id)).map(e=>({kind:'entity',record:e}))];
 container.append(document.createTextNode(`${matches.length} 条匹配记录`));
 for(const match of matches){const button=document.createElement('button');button.textContent=match.kind==='paper'?shortTitle(match.record):match.record.label;
   button.onclick=()=>{categoryFilter='';$('category-filter').value='';const paperId=match.kind==='paper'?match.record.paper_id:match.record.paper_ids[0];if(paperId){focus=paperId;if(!selected.has(paperId))setPapers([...selected,paperId]);setView('paper');showPapers();}
     const entityId=match.kind==='paper'?`paper-${paperId}`:match.record.id;const node=graph.graphData().nodes.find(n=>n.entity_id===entityId);if(node){inspect(node);focusNode(node);}else knowledgeEditor.open(match.kind==='paper'?'papers':'entities',match.kind==='paper'?paperId:entityId);
   };container.append(button);
 }
}
function annotationTarget(item){
 if(item.kind==='paper'){const id=item.paper_id||item.paper_ids?.[0];if(id)return {type:'paper',resource:'papers',id,record:papers.find(p=>p.paper_id===id)};}
 const entityId=item.entity_id||item.id,entity=entities.find(e=>e.id===entityId);if(entity)return {type:'entity',resource:'entities',id:entityId,record:entity};
 const relation=relations.find(r=>r.id===item.id);if(relation)return {type:'relation',resource:'relations',id:relation.id,record:relation};
 if(evidence.has(item.id))return {type:'evidence',resource:'evidence',id:item.id,record:evidence.get(item.id)};
 return null;
}
function renderAnnotations(item){
 const target=annotationTarget(item),panel=$('annotation-panel');panel.hidden=!target;if(!target)return;
 const key=`${target.type}:${target.id}`;if(annotationKey!==key){$('note-input').value='';annotationKey=key;}
 const targetNotes=notes.filter(note=>note.target_type===target.type&&note.target_id===target.id),tagIds=target.record?.tag_ids||[];
 $('annotation-summary').textContent=`备注 ${targetNotes.length} · 标签 ${tagIds.length}`;
 $('note-list').replaceChildren();
 for(const note of targetNotes){const card=document.createElement('div');card.className='note-card';const edit=document.createElement('button');edit.textContent='编辑';edit.onclick=()=>knowledgeEditor.open('notes',note.id);card.append(edit,document.createTextNode(note.body));$('note-list').append(card);}
 $('active-tags').replaceChildren();
 const saveTags=async values=>{try{await apiWrite(`${target.resource}/${encodeURIComponent(target.id)}`,'PATCH',{tag_ids:values},knowledge.revision);await refreshKnowledge(true);}catch(error){status(`标签未保存：${error.message}`);}};
 for(const id of tagIds){const tag=tags.find(t=>t.id===id),button=document.createElement('button');button.textContent=`${tag?.label||id} ×`;button.title='移除这个标签';button.onclick=()=>saveTags(tagIds.filter(value=>value!==id));$('active-tags').append(button);}
 $('tag-picker').replaceChildren(new Option('选择标签…',''));tags.filter(tag=>!tagIds.includes(tag.id)).forEach(tag=>$('tag-picker').add(new Option(tag.label,tag.id)));
 $('tag-picker').disabled=target.type==='evidence';$('tag-add').disabled=target.type==='evidence';
 $('tag-add').onclick=()=>{const id=$('tag-picker').value;if(id)saveTags([...tagIds,id]);};
 $('note-add').onclick=async()=>{const body=$('note-input').value.trim();if(!body)return;$('note-add').disabled=true;try{await apiWrite('notes','POST',{id:`note-${crypto.randomUUID()}`,target_type:target.type,target_id:target.id,body},knowledge.revision);$('note-input').value='';await refreshKnowledge(true);}catch(error){status(`备注未保存：${error.message}`);}finally{$('note-add').disabled=false;}};
}
async function refreshKnowledge(force=false){
 if(refreshPromise){refreshAgain=true;return refreshPromise;}
 refreshPromise=(async()=>{
   const next=await fetchJSON('/api/knowledge');if(!force&&next.revision===knowledge.revision)return next;
   knowledge=next;manifest=next.manifest;propositions=next.graph;evidenceData=next.evidence;papers=manifest.papers;entities=propositions.entities;relations=propositions.relations;
   notes=next.notes||[];tags=next.tags||[];groups=next.groups||[];
   sharedState=pendingSelections?{...next.state,selected_paper_ids:[...selected],active_group_id:sharedState.active_group_id}:next.state;
   if(!pendingSelections){selected.clear();(sharedState.selected_paper_ids||[]).forEach(id=>selected.add(id));}
   if(!papers.some(p=>p.paper_id===focus)||!selected.has(focus))focus=selected.values().next().value||papers[0]?.paper_id;
   evidence.clear();evidenceData.evidence.forEach(e=>evidence.set(e.id,e));
   $('corpus-badge').textContent=`知识库 · ${papers.length} 篇论文 · v${next.revision}`;
   showPapers();showFilters();render({fitCamera:false});knowledgeEditor?.refresh(next);preferencesEditor?.refresh(next);
   if(inspectedItem){const current=graph.graphData().nodes.find(n=>n.id===inspectedKey)||graph.graphData().links.find(l=>l.id===inspectedKey);
     if(current){const signature=x=>JSON.stringify([x.label,x.full_label,x.description,x.kind,x.source_ids,x.provenance]);if(signature(current)!==signature(inspectedItem))inspect(current);else{inspectedItem=current;renderAnnotations(current);}}
     else if(annotationTarget(inspectedItem)?.record)renderAnnotations(inspectedItem);
     else{inspectedItem=null;inspectedKey=null;$('selection').textContent='记录已删除或移出当前显示范围。';$('annotation-panel').hidden=true;}
   }
   return next;
 })().finally(()=>{refreshPromise=null;if(refreshAgain){refreshAgain=false;return refreshKnowledge(true);}});return refreshPromise;
}
function persistSelection(){
 const value={selected_paper_ids:[...selected],active_group_id:sharedState.active_group_id||null};pendingSelections++;
 stateWrites=stateWrites.catch(()=>{}).then(()=>apiWrite('state','PUT',value)).catch(error=>status(`显示范围未保存：${error.message}`)).finally(async()=>{pendingSelections--;if(!pendingSelections)await refreshKnowledge(true).catch(error=>status(`同步失败：${error.message}`));});
}
function setView(v){view=v;relationScope=null;document.querySelectorAll('#views button').forEach(b=>b.classList.toggle('active',b.dataset.view===v));render();}
function relationScopeIds(paperId,rootId){
 const available=new Set(entities.filter(e=>e.kind!=='paper'&&e.paper_ids?.includes(paperId)).map(e=>e.id));
 const found=new Set(available.has(rootId)?[rootId]:[]);
 // One semantic neighbourhood at a time: a course reveals its peer stages;
 // selecting a stage then reveals its filters. Keep containment ancestors as
 // context without recursively reopening every descendant of the whole paper.
 for(const relation of relations){
   const other=relation.source===rootId?relation.target:relation.target===rootId?relation.source:null;
   if(other&&available.has(other))found.add(other);
 }
 let changed=true;
 while(changed){changed=false;for(const relation of relations)if(technicalRelationRole(relation.type)==='containment'&&found.has(relation.target)&&available.has(relation.source)&&!found.has(relation.source)){found.add(relation.source);changed=true;}}
 return found;
}
function openRelationScope(entityId,paperId){
 if(!paperId||!selected.has(paperId))return;
 relationScope={entityId,paperId};categoryFilter='';$('category-filter').value='';
 if(view==='papers'){view='paper';document.querySelectorAll('#views button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));}
 focus=paperId;render();
 const node=graph.graphData().nodes.find(n=>n.entity_id===entityId);if(node)inspect(node);
}
function addPlane(width,height,position,rotation,opacity=.16){
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({color:palette.plane,transparent:true,opacity,side:THREE.DoubleSide,depthWrite:false}));
 mesh.position.copy(position);mesh.rotation.copy(rotation);graph.scene().add(mesh);planes.push(mesh);
 const border=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),new THREE.LineBasicMaterial({color:palette.grid,transparent:true,opacity:.055}));border.position.copy(position);border.rotation.copy(rotation);graph.scene().add(border);planes.push(border);
}
function render({fitCamera=true}={}){
 navigation.reset();
 if(relationScope&&(!selected.has(relationScope.paperId)||!entities.some(e=>e.id===relationScope.entityId)))relationScope=null;
 const included=papers.filter(p=>selected.has(p.paper_id)&&(view!=='paper'||p.paper_id===focus)&&(!relationScope||p.paper_id===relationScope.paperId));const nodes=[], links=[],byEntity=new Map();
 const scopeIds=relationScope?relationScopeIds(relationScope.paperId,relationScope.entityId):null;
 const localByPaper=new Map(included.map(p=>[p.paper_id,entities.filter(e=>e.kind!=='paper'&&e.paper_ids?.includes(p.paper_id)&&(!categoryFilter||e.category===categoryFilter)&&(!scopeIds||scopeIds.has(e.id)))]));
 // Reserve each depth as a band of staggered nodes, separated by an empty row.
 // Reserve the unchanged circle diameter after the final density scale. Merely
 // checking the unscaled layout would let nearby reasoning nodes overlap.
 const layouts=new Map(included.map(p=>[p.paper_id,layoutTechnical(localByPaper.get(p.paper_id),relations,{paperId:p.paper_id,paperEntityId:entities.find(e=>e.kind==='paper'&&e.paper_ids?.includes(p.paper_id))?.id,nodeWidth:168/nodeSpacingScale,nodeHeight:168/nodeSpacingScale})]));
 const paperPositions=layoutPapers(included,relations,{anchorId:'qwen-image-2.0'});
 const spaceScale=.65;
 if(view==='space'){
   const levels=[...new Set([...paperPositions.values()].map(point=>point.depth))].sort((a,b)=>a-b),levelWidths=new Map(),levelZ=new Map();
   for(const depth of levels)levelWidths.set(depth,Math.max(700,...included.filter(p=>paperPositions.get(p.paper_id).depth===depth).map(p=>layouts.get(p.paper_id).width*spaceScale)));
   let z=0;levels.forEach((depth,index)=>{if(index)z+=(levelWidths.get(levels[index-1])+levelWidths.get(depth))/2+700;levelZ.set(depth,z);});
   for(const point of paperPositions.values()){point.x*=1.25;point.z=levelZ.get(point.depth)-z/2;}
 }
 const columnWidths=Array.from({length:Math.min(3,included.length)},(_,column)=>Math.max(800,...included.filter((p,i)=>i%3===column).map(p=>layouts.get(p.paper_id).width+700)));
 const flatWidth=columnWidths.reduce((sum,width)=>sum+width,0),columnCenters=[];let columnCursor=-flatWidth/2;
 for(const width of columnWidths){columnCenters.push(columnCursor+width/2);columnCursor+=width;}
 const rowOffsets=[0];
 for(let i=0;i<included.length;i+=3){const height=Math.max(...included.slice(i,i+3).map(p=>layouts.get(p.paper_id).height));rowOffsets.push(rowOffsets.at(-1)+Math.max(900,height+700));}
 for(const plane of planes){graph.scene().remove(plane);plane.geometry.dispose();plane.material.dispose();}planes=[];
 included.forEach((p,index)=>{
   const {x:baseX,z:baseZ}=paperPositions.get(p.paper_id),layout=layouts.get(p.paper_id);
   const flatX=columnCenters[index%3],flatY=-rowOffsets[Math.floor(index/3)];

   const paperEntity=entities.find(e=>e.id===`paper-${p.paper_id}`)||{id:`paper-${p.paper_id}`,label:shortTitle(p),kind:'paper',source_ids:[],paper_ids:[p.paper_id]};
   const locals=localByPaper.get(p.paper_id);
   const add=(e,x,y,z,extra={})=>{const n={...e,...extra,overview:view==='space',entity_id:e.id,id:`${p.paper_id}::${e.id}`,paper_id:p.paper_id,fx:x,fy:y,fz:z};nodes.push(n);if(!byEntity.has(e.id))byEntity.set(e.id,[]);byEntity.get(e.id).push(n);return n;};
   const paperNode={...paperEntity,label:shortTitle(p),full_label:p.verified_title||p.expected_title||paperEntity.label};
   if(view==='papers')add(paperNode,baseX,-baseZ,0);
   else {
     add(paperNode,view==='space'?baseX:view==='technology'?flatX:0,view==='technology'?flatY+300:300,view==='space'?baseZ:0);
     locals.forEach(e=>{
       const point=layout.positions.get(e.id);
       add(e,view==='space'?baseX:view==='technology'?flatX+point.x:point.x,
         view==='space'?point.y*spaceScale:view==='technology'?flatY+point.y:point.y,
         view==='space'?baseZ-point.x*spaceScale:0,
         {treeDepth:point.depth,treeParentId:point.parentId,structuralParentId:point.structuralParentId,placementRole:point.placementRole,visualScale:view==='space'?spaceScale:1});
     });
     if(view==='space'&&locals.length){
       const top=420,bottom=layout.bounds.minY*spaceScale-120,height=top-bottom;
       addPlane(layout.width*spaceScale+200,height,new THREE.Vector3(baseX-5,(top+bottom)/2,baseZ-(layout.bounds.minX+layout.bounds.maxX)*spaceScale/2),new THREE.Euler(0,-Math.PI/2,0),p.paper_id===focus?.028:.012);
     }
   }
 });
 if(view==='space'&&included.length){
   const positions=[...paperPositions.values()],xs=positions.map(p=>p.x),zs=positions.map(p=>p.z);
   const x0=Math.min(...xs)-350,x1=Math.max(...xs)+350,z0=Math.min(...zs)-450,z1=Math.max(...zs)+450;
   addPlane(x1-x0,z1-z0,new THREE.Vector3((x0+x1)/2,301,(z0+z1)/2),new THREE.Euler(-Math.PI/2,0,0),.028);
 }
 // Apply one scale after arranging every paper and technical subtree so all
 // horizontal, vertical and cross-paper distances change by the same amount.
 for(const node of nodes){node.fx*=nodeSpacingScale;node.fy*=nodeSpacingScale;node.fz*=nodeSpacingScale;}
 for(const plane of planes){plane.position.multiplyScalar(nodeSpacingScale);plane.scale.setScalar(nodeSpacingScale);}
 const origins=entityOrigins(entities,relations);
 for(const r of relations){
   const pairs=relationOccurrencePairs(r,byEntity,{evidence,origins});
   for(const [from,to]of pairs){const layout=layouts.get(from.paper_id);links.push({...r,source:from.id,target:to.id,cross:from.paper_id!==to.paper_id,paperLink:from.kind==='paper'&&to.kind==='paper',semanticRole:layout?.relationRoles?.get(r.id)||technicalRelationRole(r.type),placementEdge:from.paper_id===to.paper_id&&layout?.positions.get(to.entity_id)?.parentRelationId===r.id,treeEdge:from.paper_id===to.paper_id&&layout?.treeRelationIds.has(r.id)});}
 }
 if(view!=='papers')for(const occurrences of byEntity.values())for(let i=1;i<occurrences.length;i++)links.push({source:occurrences[0].id,target:occurrences[i].id,type:'occurrence',label:'同一实体的不同论文出现位置',basis:'view',source_ids:[],cross:true,description:'这是共享身份的视图连接，不表示论文间的继承或方法借鉴。'});
 if(view!=='papers')for(const p of included){
   const paperNode=nodes.find(n=>n.paper_id===p.paper_id&&n.kind==='paper');if(!paperNode)continue;
   for(const rootId of layouts.get(p.paper_id).roots){const root=nodes.find(n=>n.paper_id===p.paper_id&&n.entity_id===rootId);if(!root)continue;
     if(!links.some(link=>link.source===paperNode.id&&link.target===root.id))links.push({source:paperNode.id,target:root.id,type:'membership',label:'论文技术切面（视图连接）',basis:'view',source_ids:[],description:'此连接用于指示所属论文，不构成学术关系断言。'});
   }
 }
 graph.graphData({nodes,links});
 graph.nodeThreeObject(n=>createNodeObject(n));
 emphasizeRelations(inspectedItem);

 const picker=$('node-picker');picker.replaceChildren(new Option('选择一个节点或关系…',''));
 const names=new Map(nodes.map(n=>[n.id,n.label]));const endpointName=n=>typeof n==='string'?names.get(n):n.label;
 nodes.forEach((n,i)=>picker.add(new Option(n.label,`n${i}`)));links.filter(l=>!['membership','occurrence'].includes(l.type)).forEach(l=>picker.add(new Option(`${endpointName(l.source)} → ${endpointName(l.target)}：${l.label}`,`l${links.indexOf(l)}`)));
 picker.onchange=()=>{if(picker.value){const item=picker.value[0]==='n'?nodes[+picker.value.slice(1)]:links[+picker.value.slice(1)];inspect(item);if(picker.value[0]==='n')focusNode(item);}};
 const selectedNode=nodes.findIndex(n=>n.id===inspectedKey),selectedLink=links.findIndex(l=>l.id===inspectedKey);
 if(selectedNode>=0)picker.value=`n${selectedNode}`;else if(selectedLink>=0)picker.value=`l${selectedLink}`;
 $('view-title').textContent={space:'三维总览',papers:'论文关系 · 横切面',paper:`${shortTitle(included[0]||{paper_id:''})||'请选择论文'} · 技术纵切面`,technology:'跨论文技术关系 · 平面展开'}[view];
 $('category-filter').hidden=view==='papers';
 $('view-description').textContent=papers.length?{space:'每篇论文下按组成与依赖展开。阶段按箭头顺序并列，采用动机与结论放在侧边；点击节点查看关系脉络。',papers:'沿引用与来源关系分层；评测等侧向关系保留连线，不作为继承层级。仅显示当前样本已有的关系。',paper:'绿色：组成；蓝色：采用与依赖；紫色：先后；橙色：动机与结论。箭头表示关系方向，位置不等同于包含。',technology:'技术切面按语义分区：组成向下展开，顺序阶段并列，依赖与论证分别连接；保留跨论文关系。'}[view]:'知识库为空。通过「管理知识库」或 Agent Skill 添加论文及其技术关系。';
 $('scope-bar').hidden=!relationScope;$('scope-name').textContent=relationScope?`关系聚焦：${entities.find(e=>e.id===relationScope.entityId)?.label||''}`:'';
 const warnings=[...layouts.values()].flatMap(layout=>layout.warnings||[]);$('layout-warning').hidden=!warnings.length;$('layout-warning').textContent=layoutWarningText(warnings);
 $('scene-footer').textContent=view==='space'?'左键平移 · 右键旋转 · 滚轮缩放 · 点击节点或连线查证':'左键平移 · 滚轮缩放 · 点击节点或连线查证';
 graph.controls().enableRotate=view==='space';graph.controls().update();if(fitCamera)resetCamera();status(papers.length?`${nodes.length} 个可见节点 · ${links.length} 条连接（含视图连接） · ${evidence.size} 段原文 · Agent 精选，学术关系尚未经用户复核`:'空知识库已就绪 · 本地数据不会同步至 GitHub');
}
function focusNode(node){navigation.reset();const target={x:node.fx,y:node.fy,z:node.fz};graph.cameraPosition(view==='space'?{x:target.x+570,y:target.y+180,z:target.z+240}:{x:target.x,y:target.y,z:target.z+600},target,400);}
function resetCamera(includeContext=false){
 navigation.reset();
 const all=graph.graphData().nodes;if(!all.length)return;
 let nodes=all;
 if(relationScope&&!includeContext&&all.length>8){
   const primary=new Set([relationScope.entityId,...relations.filter(r=>r.source===relationScope.entityId&&['containment','dependency'].includes(technicalRelationRole(r.type))).map(r=>r.target)]);
   const core=all.filter(n=>primary.has(n.entity_id));if(core.length>1)nodes=core;
 }
 const horizontalPadding=relationScope?65:200,verticalPadding=relationScope?85:180,depthPadding=relationScope?65:100;
 const min=new THREE.Vector3(Infinity,Infinity,Infinity),max=new THREE.Vector3(-Infinity,-Infinity,-Infinity);
 for(const node of nodes){min.min(new THREE.Vector3(node.fx-horizontalPadding,node.fy-70,node.fz-depthPadding));max.max(new THREE.Vector3(node.fx+horizontalPadding,node.fy+verticalPadding,node.fz+depthPadding));}
 const center=min.clone().add(max).multiplyScalar(.5),direction=(view==='space'?relationScope?new THREE.Vector3(1,.18,.22):new THREE.Vector3(1,.48,.65):new THREE.Vector3(0,0,1)).normalize();
 const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),direction).normalize(),up=new THREE.Vector3().crossVectors(direction,right);
 const projected=nodes.map(node=>new THREE.Vector3(node.fx,node.fy,node.fz).sub(center));
 for(const axis of [right,up]){
  const values=projected.map(point=>point.dot(axis));
  center.addScaledVector(axis,(Math.min(...values)+Math.max(...values))/2);
 }
 const sceneHeight=$('scene').clientHeight;
 const topInset=Math.min(sceneHeight*.4,$('scene-title').offsetTop+$('scene-title').offsetHeight+12),bottomInset=34;
 const visibleHeight=Math.max(sceneHeight*.3,sceneHeight-topInset-bottomInset);
 const tangent=Math.tan(graph.camera().fov*Math.PI/360),aspect=Math.max(.2,$('scene').clientWidth/sceneHeight);
 let distance=500;
 for(const node of nodes)for(const dx of [-horizontalPadding,horizontalPadding])for(const dy of [-80,verticalPadding])for(const dz of [-depthPadding,depthPadding]){
  const point=new THREE.Vector3(node.fx+dx,node.fy+dy,node.fz+dz).sub(center);
  distance=Math.max(distance,point.dot(direction)+Math.max(Math.abs(point.dot(right))/(tangent*aspect),Math.abs(point.dot(up))/(tangent*visibleHeight/sceneHeight))*1.12);
 }
 graph.camera().far=Math.max(100000,distance*8);graph.camera().updateProjectionMatrix();
 graph.controls().maxDistance=Math.max(100000,distance*5);
 // Fit inside the visible canvas below the title and scope controls, so the
 // very parent that explains a subtree is not hidden behind those overlays.
 const target=center.clone().addScaledVector(up,(topInset-bottomInset)/sceneHeight*tangent*distance);
 graph.cameraPosition(target.clone().addScaledVector(direction,distance),target,450);
}

function emphasizeRelations(item){
 const nodes=graph.graphData().nodes,links=graph.graphData().links;
 const entityId=item?.entity_id||(entities.some(e=>e.id===item?.id)?item.id:null);
 const selectedId=nodes.some(n=>n.entity_id===entityId)?entityId:null;
 const idOf=endpoint=>typeof endpoint==='object'?endpoint?.entity_id:nodes.find(n=>n.id===endpoint)?.entity_id;
 const active=!!selectedId||links.some(l=>l.id===item?.id);
 for(const link of links){link.emphasized=!!(selectedId&&(idOf(link.source)===selectedId||idOf(link.target)===selectedId)||!selectedId&&link.id===item?.id);link.dimmed=active&&!relationScope&&!link.emphasized&&link.semanticRole!=='sequence';}
 graph.linkThreeObject(link=>createLinkVisual(link,palette));
}
function renderRelationContext(item){
 const panel=$('relation-context');panel.replaceChildren();panel.hidden=true;
 const id=item.entity_id||item.id,entity=entities.find(e=>e.id===id),relation=relations.find(r=>r.id===item.id);
 if(!entity&&!relation)return;
 panel.hidden=false;
 const heading=document.createElement('h3');heading.textContent='关系脉络';panel.append(heading);
 const paperId=item.paper_id||entity?.paper_ids?.find(id=>selected.has(id));
 const visit=id=>{const node=graph.graphData().nodes.find(n=>n.entity_id===id&&n.paper_id===paperId)||graph.graphData().nodes.find(n=>n.entity_id===id);if(node){inspect(node);focusNode(node);}else{const record=entities.find(e=>e.id===id);if(record)inspect(record);}};
 if(relation){
   for(const [endpoint,prefix]of [[relation.source,'起点'],[relation.target,'终点']]){const button=document.createElement('button');button.className='relation-node';button.textContent=`${prefix}：${entities.find(e=>e.id===endpoint)?.label||endpoint}`;button.onclick=()=>visit(endpoint);panel.append(button);}
   const text=document.createElement('p');text.textContent=`${relationRoleNames[technicalRelationRole(relation.type)]||'关联'} · ${relation.label||relation.type} · 箭头从起点指向终点`;panel.append(text);return;
 }
 if(entity.kind!=='paper'&&paperId){const button=document.createElement('button');button.className='relation-focus';button.textContent='聚焦这一组关系';button.onclick=()=>openRelationScope(entity.id,paperId);panel.append(button);}
 const related=relations.filter(r=>r.source===id||r.target===id),groups=new Map();
 for(const r of related){const role=technicalRelationRole(r.type);if(!groups.has(role))groups.set(role,[]);groups.get(role).push(r);}
 for(const [role,title]of Object.entries(relationRoleNames)){
   const list=groups.get(role);if(!list?.length)continue;
   const details=document.createElement('details'),summary=document.createElement('summary');details.open=true;details.dataset.role=role;summary.textContent=`${title} · ${list.length}`;details.append(summary);
   for(const r of list){const outbound=r.source===id,other=entities.find(e=>e.id===(outbound?r.target:r.source));const row=document.createElement('div'),button=document.createElement('button'),source=document.createElement('button');row.className='relation-row';button.className='relation-node';button.textContent=outbound?`${r.label||r.type} → ${other?.label||r.target}`:`${other?.label||r.source} → ${r.label||r.type}`;button.onclick=()=>visit(outbound?r.target:r.source);source.className='relation-source';source.textContent='依据';source.ariaLabel=`查看关系依据：${r.label||r.type}`;source.onclick=()=>inspect(r);row.append(button,source);details.append(row);}
   panel.append(details);
 }
 if(!related.length){const text=document.createElement('p');text.textContent='尚未记录可支持的技术关系，保留为独立节点。';panel.append(text);}
}
function inspect(item){
 if(inspectedKey!==item.id)$('inspector-content').scrollTop=0;
 inspectedKey=item.id;inspectedItem=item;
 emphasizeRelations(item);renderRelationContext(item);
 sequence++;activePDFRender?.cancel();$('selection').replaceChildren();$('evidence-tabs').replaceChildren();$('evidence-meta').replaceChildren();$('quote').hidden=true;$('pdf-page').hidden=true;
 const title=document.createElement('h2');title.textContent=item.full_label||item.label||item.type;const description=document.createElement('p');description.textContent=item.description||(item.kind==='paper'?'论文记录；选择下方技术节点查看具体方法、结论与原文证据。':'具体依据见下方原文，可在备注中记录你的理解或待核查之处。');$('selection').append(title);
 for(const text of [item.kind||'关系',item.basis==='view'?'布局连接':`依据：${({explicit:'原文明示',derived:'Agent 推导',inferred:'AI 推断',unresolved:'存在冲突'})[item.basis]||'原文摘录'}`,item.provenance?.review_status==='human_verified'?'学术判断：人工已核验':'学术判断：未人工复核']){const s=document.createElement('span');s.className='state';s.textContent=text;$('selection').append(s);}$('selection').append(description);
 if(item.table_rows?.length){
   const labels={model:'模型',setting:'潜变量配置',dimension:'评测维度',encoder_params_m:'编码器参数 / M',decoder_params_m:'解码器参数 / M',imagenet_psnr:'ImageNet PSNR',imagenet_ssim:'ImageNet SSIM',text_psnr:'文字集 PSNR',text_ssim:'文字集 SSIM',qwen_image:'Qwen-Image',qwen_image_2512:'Qwen-Image-2512',qwen_image_2_0:'Qwen-Image-2.0'};
   const details=document.createElement('details'),summary=document.createElement('summary'),wrapper=document.createElement('div'),table=document.createElement('table');
   summary.textContent=`结构化结果 · ${item.table_rows.length} 项`;wrapper.className='result-table';wrapper.tabIndex=0;
   const columns=[...new Set(item.table_rows.flatMap(row=>Object.keys(row)))],head=document.createElement('tr');
   for(const key of columns){const cell=document.createElement('th');cell.textContent=labels[key]||key;head.append(cell);}table.append(head);
   for(const row of item.table_rows){const tr=document.createElement('tr');for(const key of columns){const cell=document.createElement('td');cell.textContent=typeof row[key]==='object'?JSON.stringify(row[key]):String(row[key]??'—');tr.append(cell);}table.append(tr);}
   wrapper.append(table);details.append(summary,wrapper);$('selection').append(details);
 }
 if(item.entity_id){const code=document.createElement('small');code.textContent=`实体 ID：${item.entity_id}`;$('selection').append(code);}
 const target=annotationTarget(item);if(target){const edit=document.createElement('button');edit.className='record-edit';edit.textContent='编辑记录';edit.onclick=()=>knowledgeEditor.open(target.resource,target.id);$('selection').append(edit);}renderAnnotations(item);
 const sources=(item.source_ids||[]).map(id=>evidence.get(id)).filter(Boolean);$('evidence-count').textContent=`${sources.length} 条来源`;
 for(const e of sources){const button=document.createElement('button');button.textContent=`${e.paper_id} · p.${e.page}`;button.onclick=()=>showEvidence(e,button);$('evidence-tabs').append(button);}
 if(sources.length)showEvidence(sources[0],$('evidence-tabs').firstChild);else $('evidence-meta').textContent=item.basis==='view'?'视图连接没有学术证据要求。':'当前样本未绑定原文证据。';
}
async function showEvidence(e,button){
 const turn=++sequence;activePDFRender?.cancel();$('pdf-page').hidden=true;document.querySelectorAll('#evidence-tabs button').forEach(b=>b.classList.toggle('active',b===button));$('evidence-meta').textContent='校验文件指纹并载入页面…';$('quote').textContent=e.quote;$('quote').hidden=false;
 try {
   const verified=await fetchJSON(`/api/evidence/${encodeURIComponent(e.id)}`);if(turn!==sequence)return;e=verified;$('quote').textContent=e.quote;
   const validation=e.validation||{};const checked=validation.text_exact_to_pdf_extraction===true&&validation.bboxes_within_page===true;
   $('evidence-meta').replaceChildren(document.createTextNode(`p.${e.page} · SHA-256 已匹配 · 定位离线检查：${checked?'通过':'未确认'}${validation.text_validation_scope==='caption_only'?'（仅图注文本；图中数值由 Agent 目视转录）':''} · 视觉复核：${validation.visual_review==='visually_verified'?'Agent 已检查页面':'未确认'} `));
   const open=document.createElement('a');open.href=verified.pdf_url+`#page=${e.page}`;open.target='_blank';open.rel='noopener';open.textContent='打开 PDF';$('evidence-meta').append(open);
   const cacheKey=`${e.paper_id}:${e.sha256}`;
   if(!pdfCache.has(cacheKey))pdfCache.set(cacheKey,pdfjs.getDocument({url:verified.pdf_url,isEvalSupported:false}).promise);
   const pdf=await pdfCache.get(cacheKey),page=await pdf.getPage(e.page);if(turn!==sequence)return;
   const viewport=page.getViewport({scale:1.6});const canvas=$('pdf-canvas');canvas.width=viewport.width;canvas.height=viewport.height;
   activePDFRender=page.render({canvasContext:canvas.getContext('2d'),viewport});await activePDFRender.promise;if(turn!==sequence)return;
   const boxes=[...e.bboxes,...(e.figure_bboxes||[])];$('highlights').replaceChildren();for(const [x0,y0,x1,y1]of boxes){const highlight=document.createElement('div');highlight.className='highlight';Object.assign(highlight.style,{left:`${100*x0/e.width}%`,top:`${100*y0/e.height}%`,width:`${100*(x1-x0)/e.width}%`,height:`${100*(y1-y0)/e.height}%`});$('highlights').append(highlight);}$('pdf-page').hidden=false;
   $('pdf-scroll').scrollTop=0;status(`已打开 ${e.paper_id} 第 ${e.page} 页 · ${boxes.length} 处高亮 · 原文定位通过不等于学术断言已人工核验`);
 }catch(error){if(turn!==sequence||error.name==='RenderingCancelledException')return;$('evidence-meta').textContent=`证据未能打开：${error.message}`;status('证据打开失败，未伪报成功。');}
}
document.querySelectorAll('#views button').forEach(button=>button.onclick=()=>setView(button.dataset.view));$('reset').onclick=()=>resetCamera(true);
$('scope-reset').onclick=()=>{relationScope=null;render();};
function setPapers(ids,activeGroupId=null){relationScope=null;selected.clear();ids.forEach(id=>{if(papers.some(p=>p.paper_id===id))selected.add(id);});if(!selected.has(focus))focus=selected.values().next().value;sharedState={...sharedState,selected_paper_ids:[...selected],active_group_id:activeGroupId};showPapers();showFilters();render();persistSelection();}
$('preset-core').onclick=()=>setPapers(coreIds);
$('preset-all').onclick=()=>setPapers(papers.map(p=>p.paper_id));
$('preset-anchor').onclick=()=>setPapers(['qwen-image-2.0']);
$('select-all-papers').onchange=event=>setPapers(event.target.checked?papers.map(p=>p.paper_id):[]);
$('group-picker').onchange=()=>{const group=groups.find(g=>g.id===$('group-picker').value);setPapers(group?group.paper_ids:[...selected],group?.id||null);};
$('tag-filter').onchange=showTagResults;
$('category-filter').onchange=()=>{relationScope=null;categoryFilter=$('category-filter').value;render();};
const createNodeObject=graph.nodeThreeObject(),createLinkObject=graph.linkThreeObject();
document.addEventListener('smg:theme-change',()=>{palette=readPalette();graph.backgroundColor(palette.bg).linkThreeObject(l=>createLinkObject(l));render({fitCamera:false});});
// Resizing a panel changes the viewport, never the user's camera or orbit target.
new ResizeObserver(()=>{const rect=$('scene').getBoundingClientRect();graph.width(rect.width).height(rect.height);}).observe($('scene'));
knowledgeEditor=setupKnowledgeEditor({onChanged:()=>refreshKnowledge(true)});knowledgeEditor.refresh(knowledge);$('knowledge-open').hidden=false;
preferencesEditor=setupPreferencesEditor({onChanged:()=>refreshKnowledge(true)});preferencesEditor.refresh(knowledge);$('preferences-open').hidden=false;
showPapers();showFilters();render();
const updates=new EventSource('/api/knowledge/events');
updates.addEventListener('revision',event=>{const revision=JSON.parse(event.data).revision;if(revision!==knowledge.revision)refreshKnowledge().catch(error=>status(`同步失败：${error.message}`));});
setInterval(()=>{if(document.visibilityState==='visible')refreshKnowledge().catch(()=>{});},10000);
