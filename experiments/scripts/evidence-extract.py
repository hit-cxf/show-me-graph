"""Build an Agent-curated evidence fixture from actual versioned pilot PDFs.

This is not an automatic extraction pipeline or a GROBID/Docling comparison.
Selections are PDF text-line indices verified on the fixed file SHA-256.
"""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import pymupdf

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'experiments/corpus'
manifest = json.loads((OUT / 'manifest.json').read_text())
papers = {row['paper_id']:row for row in manifest['papers']}
documents = {}
for paper_id, row in papers.items():
    if row['pdf']['status'] == 'downloaded':
        path = ROOT / row['pdf']['artifact_path']
        doc = pymupdf.open(path)
        documents[paper_id] = doc
        row['pdf']['pages'] = len(doc)
        row['pdf']['parse_status'] = 'opened_and_text_extracted'
        row['pdf']['embedded_title'] = doc.metadata.get('title')
        row['pdf']['embedded_version_marker'] = next((line for line in doc[0].get_text().splitlines() if row['version_id'] in line), None)
        path.with_suffix('.txt').write_text('\n\n'.join(f'=== PAGE {i+1} ===\n{page.get_text()}' for i,page in enumerate(doc)))
(OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')

# inclusive start/end line indices in PyMuPDF dict order; no semantic quote rewriting.
specs = [
 ('q2-architecture','qwen-image-2.0',10,40,46,'三大核心组件','§3'),
 ('q2-caption','qwen-image-2.0',10,34,39,'冻结编码器与归一化/激活说明','Figure 8'),
 ('q2-compression','qwen-image-2.0',10,49,52,'采用16倍压缩','§3.1'),
 ('q2-tradeoff','qwen-image-2.0',10,53,58,'压缩、重建、可扩散性权衡','§3.1'),
 ('q2-residual','qwen-image-2.0',10,59,60,'借鉴残差自编码架构','§3.1'),
 ('q2-f16c64','qwen-image-2.0',11,92,94,'64通道与f16c64','§3.1'),
 ('q2-va-vae','qwen-image-2.0',11,98,101,'跟随VA-VAE加入语义对齐','§3.1'),
 ('q2-dynamic-alignment','qwen-image-2.0',11,102,105,'动态语义对齐的作者观察','§3.1'),
 ('q2-drop-adversarial','qwen-image-2.0',11,105,107,'去除对抗目标的作者观察','§3.1'),
 ('q2-table1-head','qwen-image-2.0',11,0,11,'表1列定义','Table 1'),
 ('q2-table1-qwen1','qwen-image-2.0',11,52,59,'表1初代Qwen-Image行','Table 1'),
 ('q2-table1-qwen2','qwen-image-2.0',11,84,91,'表1Qwen-Image-2.0行','Table 1'),
 ('q2-table1-scope','qwen-image-2.0',11,108,115,'表1评测范围','§3.1 / Table 1'),
 ('q2-mmdit','qwen-image-2.0',11,118,121,'采用MMDiT架构','§3.2'),
 ('q2-msrope','qwen-image-2.0',11,131,134,'使用MSRoPE与去偏置调制','§3.2'),
 ('q2-swiglu-reason','qwen-image-2.0',12,0,3,'SwiGLU采用原因','§3.2'),
 ('q2-swiglu-formula','qwen-image-2.0',12,4,7,'SwiGLU公式与算子','§3.2 Equation 3'),
 ('q2-prompt-enhancer','qwen-image-2.0',12,10,16,'提示词增强器的功能','§3.3'),
 ('q2-grpo','qwen-image-2.0',16,14,23,'改造GRPO与混合CFG策略','§4.2'),
 ('q2-distillation-background','qwen-image-2.0',16,41,45,'蒸馏相关工作的背景引用','§4.3'),
 ('q2-dmd','qwen-image-2.0',16,46,49,'明确采用DMD','§4.3'),
 ('q2-teacher-caption','qwen-image-2.0',17,0,4,'图11使用RL教师的描述','Figure 11'),
 ('q2-teacher-body','qwen-image-2.0',17,16,22,'正文使用Base教师的描述','§4.3 Results'),
 ('dcae-residual','dc-ae',4,59,67,'残差自编码器的定义','§3.2'),
 ('dcae-family','dc-ae',2,98,99,'提出DC-AE家族','§1'),
 ('dcae-fc-definition','dc-ae',8,200,201,'f与c的含义','§4.2'),
 ('sd3-mmdit','sd3',5,98,104,'MMDiT的双模态权重与联合注意力','§4'),
 ('sd3-ldm','sd3',4,134,136,'SD3沿用LDM潜空间训练设置','§4'),
 ('meanflow-definition','mean-flows',3,40,43,'MeanFlow平均速度定义','§4.1'),
 ('q1-msrope','qwen-image',9,57,60,'初代Qwen-Image的MSRoPE','Figure 8'),
]
evidence = []
for eid, paper_id, pn, start, end, title, section in specs:
    doc = documents[paper_id]
    page = doc[pn-1]
    lines = [line for block in page.get_text('dict')['blocks'] if 'lines' in block for line in block['lines']]
    selected = lines[start:end+1]
    texts = [''.join(span['text'] for span in line['spans']) for line in selected]
    bboxes = [[round(v,4) for v in line['bbox']] for line in selected]
    source = papers[paper_id]['pdf']
    evidence.append({'id':eid,'paper_id':paper_id,'artifact_path':source['artifact_path'],
        'sha256':source['sha256'],'page':pn,'width':round(page.rect.width,4),'height':round(page.rect.height,4),
        'title':title,'section':section,'quote':'\n'.join(texts),'bboxes':bboxes,
        'source_url':source['requested_url'],'method':'PyMuPDF get_text(dict); Agent-selected exact lines',
        'line_indices':list(range(start,end+1)),
        'validation':{'file_hash_match':hashlib.sha256((ROOT/source['artifact_path']).read_bytes()).hexdigest()==source['sha256'],
                      'text_exact_to_pdf_extraction':True,'bboxes_within_page':all(0<=b[0]<b[2]<=page.rect.width and 0<=b[1]<b[3]<=page.rect.height for b in bboxes),
                      'visual_review':'pending','semantic_review':'agent_curated_not_independent_human_review'}})
payload = {'schema_version':'0.1','generated_at':datetime.now(timezone.utc).isoformat(),
    'coordinate_system':{'origin':'top-left','unit':'PDF points (1/72 inch)','page_indexing':'1-based','bbox_format':['x0','y0','x1','y1']},
    'quote_policy':'Exact PDF text-layer line content with newline delimiters; retains PDF line-break hyphenation. Formula fidelity requires visual review.',
    'evidence':evidence}
review_path=OUT/'visual-review.json'
if review_path.exists():
    reviewed=json.loads(review_path.read_text())['pages']
    for anchor in evidence:
        if any(r['paper_id']==anchor['paper_id'] and r['page']==anchor['page'] and r['sha256']==anchor['sha256'] and r['status']=='visually_verified' for r in reviewed):
            anchor['validation']['visual_review']='visually_verified'
(OUT/'evidence.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n')

def entity(eid,label,kind,paper_ids,source_ids,description):
    return {'id':eid,'label':label,'kind':kind,'paper_ids':paper_ids,'source_ids':source_ids,'description':description}
E = []
for pid in ['qwen-image-2.0','qwen-image','sd3','dc-ae','mean-flows','reconstruction-vs-generation','dmd','qwen3-vl','ldm','flow-grpo']:
    E.append(entity('paper-'+pid,papers[pid]['verified_title'],'paper',[pid],[],
                    '固定版本 '+papers[pid]['version_id']+'；书目来自 arXiv 版本页。'))
E += [
 entity('qwen2-model','Qwen-Image-2.0','system',['qwen-image-2.0'],['q2-architecture'],'条件编码、图像潜变量编解码与扩散建模组成的系统。'),
 entity('qwen2-vae','Qwen-Image-2.0 VAE','component',['qwen-image-2.0'],['q2-f16c64','q2-compression'],'f16c64；f是单个空间维的缩小倍数，c是潜通道数。'),
 entity('qwen2-mmdit','Qwen-Image-2.0 MMDiT','component',['qwen-image-2.0'],['q2-mmdit'],'条件潜空间去噪骨干；本论文的具体实现。'),
 entity('qwen3-vl-encoder','Qwen3-VL','system',['qwen3-vl','qwen-image-2.0'],['q2-architecture','q2-caption'],'Qwen-Image-2.0中充当冻结条件编码器；此样本角色证据来自使用方论文。'),
 entity('mmdit','MMDiT','method',['sd3','qwen-image-2.0'],['sd3-mmdit','q2-mmdit'],'跨论文共享的方法身份；各论文实现不因此等同。'),
 entity('swiglu','SwiGLU','method',['qwen-image-2.0'],['q2-swiglu-reason','q2-swiglu-formula'],'线性投影与SiLU门控逐元素相乘；本样本未溯源至最初提出文献。'),
 entity('msrope','MSRoPE','method',['qwen-image','qwen-image-2.0'],['q1-msrope','q2-msrope'],'跨论文复用的联合位置编码方法。'),
 entity('dc-ae','DC-AE','system',['dc-ae'],['dcae-family','dcae-residual','dcae-fc-definition'],'高空间压缩自编码器家族。'),
 entity('residual-autoencoding','Residual Autoencoding','method',['dc-ae','qwen-image-2.0'],['dcae-residual','q2-residual'],'用非参数空间到通道捷径辅助学习残差。'),
 entity('fc-definition','f/c 配置定义','concept',['dc-ae','qwen-image-2.0'],['dcae-fc-definition','q2-f16c64'],'f表示空间压缩倍数，c表示潜通道数；不是文件存储压缩率。'),
 entity('semantic-alignment','语义对齐损失（VA-VAE来源）','method',['reconstruction-vs-generation','qwen-image-2.0'],['q2-va-vae'],'使用方明确称follow VA-VAE；源论文细节尚未加入此精选样本。'),
 entity('vae-tradeoff','压缩/重建/可扩散性权衡','finding',['qwen-image-2.0'],['q2-tradeoff'],'作者关于高压缩VAE的条件性论述，不是无条件定理。'),
 entity('vae-table1','VAE重建对比（表1）','finding',['qwen-image-2.0'],['q2-table1-head','q2-table1-qwen1','q2-table1-qwen2','q2-table1-scope'],'ImageNet与内部文字集的256×256重建指标；不能推成全面更优。'),
 entity('qwen2-rl','Qwen-Image-2.0 RLHF','method',['qwen-image-2.0'],['q2-grpo'],'采用改造的GRPO；rollout使用CFG，优化排除无条件分支。'),
 entity('dmd','Distribution Matching Distillation','method',['dmd','qwen-image-2.0'],['q2-dmd'],'Qwen-Image-2.0明确采用的少步蒸馏范式。'),
 entity('qwen2-distillation','Qwen-Image-2.0 Distillation','system',['qwen-image-2.0'],['q2-teacher-caption','q2-teacher-body'],'4 NFE学生；教师Base/RL在图注和正文表述不一致，保留冲突。'),
 entity('meanflow','MeanFlow','method',['mean-flows'],['meanflow-definition'],'学习平均速度；在Qwen报告中属于背景引用，不建采用关系。'),
 entity('average-velocity','平均速度','concept',['mean-flows'],['meanflow-definition'],'两个时刻间位移除以时间间隔。'),
 entity('prompt-enhancer','Prompt Enhancer','component',['qwen-image-2.0'],['q2-prompt-enhancer'],'将用户查询改写为结构化详细提示。'),
]
R = []
def rel(source,target,type_,label,ids,description='',basis='explicit'):
    R.append({'id':f'r{len(R)+1:02d}','source':source,'target':target,'type':type_,'label':label,'basis':basis,'source_ids':ids,'description':description})
rel('paper-qwen-image-2.0','qwen2-model','presents','提出',['q2-architecture'])
for target in ['qwen2-vae','qwen2-mmdit','qwen3-vl-encoder']:
    rel('qwen2-model',target,'has_component','核心组件',['q2-architecture'])
rel('qwen2-mmdit','mmdit','implements','采用架构',['q2-mmdit'])
rel('qwen2-mmdit','swiglu','uses','MLP激活函数',['q2-swiglu-reason','q2-swiglu-formula'])
rel('qwen2-mmdit','msrope','uses','位置编码',['q2-msrope'])
rel('qwen2-vae','residual-autoencoding','adopts','借鉴架构',['q2-residual'])
rel('qwen2-vae','semantic-alignment','uses','采用训练目标',['q2-va-vae'])
rel('qwen2-vae','fc-definition','has_configuration','f16c64',['q2-f16c64','dcae-fc-definition'])
rel('qwen2-vae','vae-tradeoff','discusses','设计权衡',['q2-tradeoff'])
rel('qwen2-vae','vae-table1','evaluated_by','重建评测',['q2-table1-scope','q2-table1-qwen2'])
rel('qwen2-model','qwen2-rl','trained_with','偏好对齐',['q2-grpo'])
rel('qwen2-distillation','dmd','trained_with','采用DMD',['q2-dmd'])
rel('paper-qwen-image-2.0','qwen2-distillation','presents','报告少步变体',['q2-teacher-body'])
rel('paper-qwen-image-2.0','prompt-enhancer','presents','提出改写模块',['q2-prompt-enhancer'])
rel('paper-dc-ae','dc-ae','presents','提出',['dcae-family'])
rel('dc-ae','residual-autoencoding','uses','残差自编码',['dcae-residual'])
rel('dc-ae','fc-definition','uses_notation','配置记法',['dcae-fc-definition'])
rel('paper-sd3','mmdit','presents','提出架构',['sd3-mmdit'])
rel('paper-qwen-image','msrope','presents','提出位置编码',['q1-msrope'])
rel('paper-mean-flows','meanflow','presents','提出方法',['meanflow-definition'])
rel('meanflow','average-velocity','models','学习对象',['meanflow-definition'])
for target,label,ids in [
 ('paper-qwen-image','沿用MSRoPE',['q2-msrope','q1-msrope']),
 ('paper-sd3','采用MMDiT',['q2-mmdit','sd3-mmdit']),
 ('paper-dc-ae','借鉴残差自编码',['q2-residual','dcae-residual']),
 ('paper-reconstruction-vs-generation','跟随VA-VAE',['q2-va-vae']),
 ('paper-qwen3-vl','采用条件编码器',['q2-architecture']),
 ('paper-dmd','采用DMD',['q2-dmd']),
 ('paper-mean-flows','背景引用',['q2-distillation-background'])]:
    rel('paper-qwen-image-2.0',target,'cites',label,ids,'论文引用方向为使用方/引用方 → 来源方；不能统一解读成继承。')
rel('paper-sd3','paper-ldm','cites','沿用潜空间设置',['sd3-ldm'])
propositions = {'schema_version':'0.1','sample_kind':'agent_curated','coverage':'Selected evidence from 5 papers; 10 downloaded PDFs are not 10 deeply reviewed papers.',
 'entities':E,'relations':R,
 'conflicts':[{'id':'teacher-base-vs-rl','subject':'qwen2-distillation','source_ids':['q2-teacher-caption','q2-teacher-body'],
 'status':'unresolved','description':'Figure 11 caption says Qwen-Image-2.0-RL teacher; Results body says Qwen-Image-2.0-Base teacher. Do not silently choose one.'}],
 'negative_examples':[{'id':'meanflow-not-adoption','source':'qwen2-model','target':'meanflow','rejected_type':'uses',
 'source_ids':['q2-distillation-background','q2-dmd'],'reason':'Mean Flows (Geng et al., 2025) is a background citation; explicit adoption statement names DMD.'}],
 'notes':['No full automatic entity/relation extraction was run.','Method identities were selected by this Agent and remain inspectable, not independently human-verified.']}
(OUT/'propositions.json').write_text(json.dumps(propositions,ensure_ascii=False,indent=2)+'\n')

# Render original pages and diagnostic overlays; original PDF bytes remain unchanged.
pages_to_render = [('qwen-image-2.0',p) for p in [10,11,12,16,17]] + [('dc-ae',2),('dc-ae',4),('dc-ae',8),('sd3',4),('sd3',5),('mean-flows',3),('qwen-image',9)]
(OUT/'pages').mkdir(exist_ok=True)
for pid,pn in pages_to_render:
    page=documents[pid][pn-1]
    base = OUT/'pages'/f'{pid}-p{pn:02d}'
    page.get_pixmap(matrix=pymupdf.Matrix(1.5,1.5),alpha=False).save(str(base)+'.png')
    # Copy page into an in-memory scratch document for annotation; never save edited PDF.
    scratch=pymupdf.open(); scratch.insert_pdf(documents[pid],from_page=pn-1,to_page=pn-1)
    for anchor in [e for e in evidence if e['paper_id']==pid and e['page']==pn]:
        for bbox in anchor['bboxes']:
            scratch[0].draw_rect(pymupdf.Rect(bbox),color=(0.08,0.45,0.75),width=0.5)
    scratch[0].get_pixmap(matrix=pymupdf.Matrix(1.5,1.5),alpha=False).save(str(base)+'-overlay.png')
    scratch.close()
print(json.dumps({'pdfs':len(documents),'anchors':len(evidence),'entities':len(E),'relations':len(R),'rendered_pages':len(pages_to_render)}))
