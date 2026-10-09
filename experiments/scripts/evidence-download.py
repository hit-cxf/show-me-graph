"""Fetch a fixed-version pilot corpus. No Zotero or remote writes."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'experiments/corpus'
OUT.mkdir(parents=True, exist_ok=True)
PAPERS = [
    ('qwen-image-2.0', '2605.10730', 'Qwen-Image-2.0 Technical Report'),
    ('qwen-image', '2508.02324', 'Qwen-Image Technical Report'),
    ('qwen3-vl', '2511.21631', 'Qwen3-VL Technical Report'),
    ('sd3', '2403.03206', 'Scaling Rectified Flow Transformers for High-Resolution Image Synthesis'),
    ('dc-ae', '2410.10733', 'Deep Compression Autoencoder for Efficient High-Resolution Diffusion Models'),
    ('reconstruction-vs-generation', '2501.01423', 'Reconstruction vs. Generation: Taming Optimization Dilemma in Latent Diffusion Models'),
    ('flow-grpo', '2505.05470', 'Flow-GRPO: Training Flow Matching Models via Online RL'),
    ('dmd', '2311.18828', 'One-step Diffusion with Distribution Matching Distillation'),
    ('mean-flows', '2505.13447', 'Mean Flows for One-step Generative Modeling'),
    ('ldm', '2112.10752', 'High-Resolution Image Synthesis with Latent Diffusion Models'),
]

def fetch(url, filename, is_pdf=False):
    record = {'requested_url': url, 'artifact_path': str(filename.relative_to(ROOT)), 'retrieved_at': datetime.now(timezone.utc).isoformat()}
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'ShowMeGraph-M0/0.1 research feasibility (local archival)'})
        with urllib.request.urlopen(req, timeout=90) as response:
            content = response.read()
            record.update(final_url=response.url, content_type=response.headers.get('Content-Type'), http_status=response.status)
        if is_pdf and not content.startswith(b'%PDF-'):
            raise ValueError('Response is not a PDF')
        filename.write_bytes(content)
        record.update(status='downloaded', sha256=hashlib.sha256(content).hexdigest(), bytes=len(content))
        return record, content
    except Exception as exc:
        record.update(status='failed', error=f'{type(exc).__name__}: {exc}')
        return record, None

def paper_task(spec):
    slug, arxiv_id, expected_title = spec
    version_id = arxiv_id + 'v1'
    record = {'paper_id': slug, 'arxiv_id': arxiv_id, 'version': 'v1', 'version_id': version_id,
              'expected_title': expected_title, 'version_policy': 'fixed initial submission; not claimed latest'}
    metadata, content = fetch(f'https://arxiv.org/abs/{version_id}', OUT / f'{slug}-v1-abs.html')
    record['metadata'] = metadata
    if content:
        html = content.decode('utf-8', errors='replace')
        record['verified_title'] = next(iter(re.findall(r'<meta name="citation_title" content="([^"]*)"', html)), None)
        record['citation_date'] = next(iter(re.findall(r'<meta name="citation_date" content="([^"]*)"', html)), None)
        record['metadata_verification'] = 'arxiv versioned abstract metadata retrieved'
        record['license_urls'] = sorted(set(re.findall(r'href="(https://creativecommons.org/[^\"]+)"', html)))
    pdf, _ = fetch(f'https://arxiv.org/pdf/{version_id}', OUT / f'{slug}-v1.pdf', is_pdf=True)
    record['pdf'] = pdf
    if slug == 'qwen-image-2.0':
        snapshot, _ = fetch(f'https://arxiv.org/html/{version_id}', OUT / f'{slug}-v1.html')
        record['html'] = snapshot
    print(json.dumps({'paper_id':slug, 'pdf_status':pdf['status'], 'bytes':pdf.get('bytes')}), flush=True)
    return record

if __name__ == '__main__':
    records = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(paper_task, spec) for spec in PAPERS]
        for future in as_completed(futures):
            records.append(future.result())
            records.sort(key=lambda row: [x[0] for x in PAPERS].index(row['paper_id']))
            manifest = {'schema_version':'0.1', 'created_at':datetime.now(timezone.utc).isoformat(),
                        'purpose':'M0 pilot corpus; downloads and source metadata, not a completed literature review',
                        'papers':records}
            (OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
