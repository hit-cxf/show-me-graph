"""Reject version, quote, and coordinate corruption; no silent relocation."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import pymupdf

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'experiments/corpus'
payload = json.loads((OUT/'evidence.json').read_text())
docs={}; hashes={}
def validate(anchor):
    path=ROOT/anchor['artifact_path']
    key=str(path)
    if key not in docs:
        docs[key]=pymupdf.open(path)
        hashes[key]=hashlib.sha256(path.read_bytes()).hexdigest()
    failures=[]
    if hashes[key]!=anchor['sha256']:
        return ['file_hash_mismatch']
    if not 1<=anchor['page']<=len(docs[key]):
        return ['invalid_page']
    page=docs[key][anchor['page']-1]
    if abs(page.rect.width-anchor['width'])>.001 or abs(page.rect.height-anchor['height'])>.001:
        failures.append('page_dimensions_mismatch')
    lines=[l for b in page.get_text('dict')['blocks'] if 'lines' in b for l in b['lines']]
    selected=[lines[i] for i in anchor['line_indices']]
    actual_quote='\n'.join(''.join(s['text'] for s in l['spans']) for l in selected)
    if actual_quote!=anchor['quote']:
        failures.append('quote_mismatch')
    if len(selected)!=len(anchor['bboxes']) or any(abs(a-b)>.01 for line,box in zip(selected,anchor['bboxes']) for a,b in zip(line['bbox'],box)):
        failures.append('bbox_mismatch')
    return failures

results=[{'id':a['id'],'failures':validate(a)} for a in payload['evidence']]
negative=[]
for case in ['file_hash','quote','bbox','page']:
    a=deepcopy(payload['evidence'][0])
    if case=='file_hash': a['sha256']='0'*64
    if case=='quote': a['quote']='This unsupported sentence does not occur at this anchor.'
    if case=='bbox': a['bboxes'][0][1]+=20
    if case=='page': a['page']=999
    failure=validate(a)
    assert failure,case
    negative.append({'case':case,'result':'rejected','failures':failure})
assert all(not r['failures'] for r in results)
report={'anchors_validated':len(results),'valid':sum(not r['failures'] for r in results),
        'invalid':sum(bool(r['failures']) for r in results),'negative_checks':negative,
        'scope':'Integrity and anchor geometry only. Does not independently validate academic semantics.',
        'results':results}
(OUT/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='results'}))
