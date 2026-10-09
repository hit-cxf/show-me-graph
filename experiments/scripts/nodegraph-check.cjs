#!/usr/bin/env node
// Reproducible M0 audit. Writes only into vendor/NodeGraph/.m0.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const repo = path.resolve(__dirname, '../vendor/NodeGraph');
const out = path.join(repo, '.m0');
fs.mkdirSync(out, { recursive: true });
const pdf = path.resolve(__dirname, '../corpus/qwen-image-2.0-v1.pdf');
const quote = 'In practice, we observe that joint text-image training may induce excessively large activation magnitudes, leading to premature neuron saturation in the model (Sun et al., 2024a). To alleviate this issue, we introduce a SwiGLU module into the Multilayer Perceptron (MLP) layers.';
const node = (id, extra = {}) => ({ id, template:'method', title:id, content:'Synthetic M0 diagnostic, not research knowledge.', contentExpanded:true, originalExpanded:true, childrenExpanded:true, position:{x:0,y:0}, children:[], images:[], links:[], ...extra });
const graph = (extra = {}) => ({ version:'1.0', title:'M0 diagnostic', created:'2026-10-04T00:00:00Z', modified:'2026-10-04T00:00:00Z', conventions:{reader:'M0 evaluator',landmark:'Check source verification behavior'}, nodeTemplates:{method:{label:'Method',color:'#4488ff',icon:'M',shape:'rounded'}}, nodes:[node('node_001',{original:{text:quote,location:'§3.2, p.12'}})], edges:[], viewport:{x:0,y:0,zoom:1}, source:{pdf:'source.pdf'}, ...extra });
const edge = (id, source,target) => ({id,source,target,type:'arrow',label:'synthetic'});
const cases = [
  ['correct_page', graph(), 'accept'],
  ['wrong_page', graph({nodes:[node('node_001',{original:{text:quote,location:'p.11'}})]}), 'reject'],
  ['false_prefix', graph({nodes:[node('node_001',{original:{text:'This completely fabricated sentence asserts that penguins invented the model and trained it on Neptune.',location:'p.12'}})]}), 'reject'],
  ['false_suffix', graph({nodes:[node('node_001',{original:{text:quote.slice(0,110)+' and therefore penguins invented this model on Neptune.',location:'p.12'}})]}), 'reject'],
  ['missing_pdf', graph({source:{pdf:'absent.pdf'}}), 'reject'],
  ['missing_page', graph({nodes:[node('node_001',{original:{text:quote,location:'§3.2'}})]}), 'reject'],
  ['short_quote', graph({nodes:[node('node_001',{original:{text:'penguins',location:'p.12'}})]}), 'reject'],
  ['missing_source', graph({source:undefined}), 'reject'],
  ['cycle', graph({nodes:[node('node_001'),node('node_002')],edges:[edge('e1','node_001','node_002'),edge('e2','node_002','node_001')]}), 'unconstrained'],
  ['two_parents', graph({nodes:[node('node_001'),node('node_002'),node('node_003')],edges:[edge('e1','node_001','node_003'),edge('e2','node_002','node_003')]}), 'unconstrained'],
  ['fanout_five', graph({nodes:Array.from({length:6},(_,i)=>node('node_'+String(i+1).padStart(3,'0'))),edges:Array.from({length:5},(_,i)=>edge('e'+i,'node_001','node_'+String(i+2).padStart(3,'0')))}), 'valid_domain_graph'],
  ['internal_valid', graph({nodes:[node('node_001',{links:[{type:'internal',target:'other.nodegraph.json#node_001',label:'Same id in another document'}]})]}), 'accept'],
  ['internal_missing', graph({nodes:[node('node_001',{links:[{type:'internal',target:'other.nodegraph.json#node_099',label:'Missing node'}]})]}), 'reject'],
  ['crossgraph_edge', graph({nodes:[node('node_001')],edges:[edge('e1','node_001','other.nodegraph.json#node_001')]}), 'desired_domain_capability'],
];
const Ajv = require(path.join(repo,'node_modules/ajv'));
const addFormats = require(path.join(repo,'node_modules/ajv-formats'));
const ajv = new Ajv({strict:false}); addFormats(ajv);
const validate = ajv.compile(JSON.parse(fs.readFileSync(path.join(repo,'schema/nodegraph.schema.json'),'utf8')));
const results = { testedAt:new Date().toISOString(), revision:spawnSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).stdout.trim(), node:process.version, cases:[], demos:[] };
for (const [name,g,desired] of cases) {
  const dir = path.join(out,name); fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'test.nodegraph.json'),JSON.stringify(g,null,2));
  const link = path.join(dir,'source.pdf'); if (!fs.existsSync(link)) fs.symlinkSync(pdf,link);
  if(name.startsWith('internal_') || name==='crossgraph_edge') fs.writeFileSync(path.join(dir,'other.nodegraph.json'),JSON.stringify(graph({title:'Other graph: separate document identity',nodes:[node('node_001',{title:'Separate node_001 in second graph'})]}),null,2));
  const r=spawnSync(process.execPath,[path.join(repo,'tools/verify-nodegraph.js'),dir],{encoding:'utf8'});
  results.cases.push({name,desired,schemaValid:validate(g),schemaErrors:validate.errors,exitCode:r.status,stdout:r.stdout,stderr:r.stderr});
}
for(const ex of ['ex1','ex2','ex3','ex4','ex5']){
  const dir=path.join(repo,'demo',ex);
  const file=fs.readdirSync(dir).find(n=>n.endsWith('.nodegraph.json'));
  const g=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
  const r=spawnSync(process.execPath,[path.join(repo,'tools/verify-nodegraph.js'),dir],{encoding:'utf8'});
  results.demos.push({example:ex,file,nodes:g.nodes.length,edges:g.edges.length,schemaValid:validate(g),schemaErrors:validate.errors,exitCode:r.status,stdout:r.stdout,stderr:r.stderr});
}
async function main(){
  const esbuild=require(path.join(repo,'node_modules/esbuild'));
  const matcherPath=path.join(out,'textMatch.cjs');
  esbuild.buildSync({entryPoints:[path.join(repo,'src/pdfviewer/textMatch.ts')],bundle:true,platform:'node',format:'cjs',outfile:matcherPath});
  const {buildPageWordMap,findInPage}=require(matcherPath);
  const pdfjs=await import(pathToFileURL(path.join(repo,'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
  const doc=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(pdf)),useSystemFonts:true}).promise;
  const page=await doc.getPage(12);
  const items=(await page.getTextContent({disableNormalization:true})).items;
  const map=buildPageWordMap(items);
  results.matcher={page:12,items:items.length,tests:cases.filter(x=>['correct_page','false_prefix','false_suffix','short_quote'].includes(x[0])).map(([name,g])=>{
    const query=g.nodes[0].original.text;const m=findInPage(map,query);
    return {name,result:m?{method:m.method,score:m.score,itemIndices:m.itemIndices,matchedText:m.itemIndices.map(i=>items[i].str).join(' ')}:null};
  })};
  await doc.destroy();
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({revision:results.revision,node:results.node,cases:results.cases.map(({name,exitCode,schemaValid})=>({name,exitCode,schemaValid})),demos:results.demos.map(({example,nodes,edges,schemaValid,exitCode})=>({example,nodes,edges,schemaValid,exitCode})),matcher:results.matcher.tests.map(({name,result})=>({name,method:result?.method,score:result?.score}))},null,2));
}
main().catch(e=>{console.error(e);process.exit(1)});
