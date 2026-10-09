"""Retry the failed pilot PDF fetches while preserving attempt history."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
import re
from pathlib import Path

spec = importlib.util.spec_from_file_location('fetcher', Path(__file__).with_name('evidence-download.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
manifest_path = m.OUT / 'manifest.json'
manifest = json.loads(manifest_path.read_text())

def retry(record):
    if record['pdf']['status'] == 'downloaded':
        return record
    record['pdf_attempts'] = [record['pdf']]
    for url in [f"https://arxiv.org/pdf/{record['version_id']}.pdf", f"https://export.arxiv.org/pdf/{record['version_id']}"]:
        result, content = m.fetch(url, m.ROOT / record['pdf']['artifact_path'], is_pdf=True)
        record['pdf_attempts'].append(result)
        record['pdf'] = result
        if content:
            break
    print(record['paper_id'], record['pdf']['status'], flush=True)
    return record

with ThreadPoolExecutor(max_workers=3) as pool:
    manifest['papers'] = list(pool.map(retry, manifest['papers']))
for record in manifest['papers']:
    html = (m.ROOT / record['metadata']['artifact_path']).read_text()
    record['license_urls'] = sorted(set(re.findall(r'href=[\'\"](https?://creativecommons.org/[^\'\"]+)', html)))
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
