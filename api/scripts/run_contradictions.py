import httpx, asyncio, time, json, sys

API = 'http://localhost:8080/api/v1'
DOCS_DIR = 'api/scripts/test_docs'
docs = [
    ('corporate_security_manual.md', 'text/markdown', 'Corporate Security Manual'),
    ('employee_handbook_extract.md', 'text/markdown', 'Employee Handbook'),
    ('procurement_and_vendor_control.txt', 'text/plain', 'Procurement & Vendor Control'),
    ('incident_response_playbook.txt', 'text/plain', 'Incident Response Playbook'),
    ('records_retention_standard.pdf', 'application/pdf', 'Records Retention Standard'),
    ('business_continuity_program.pdf', 'application/pdf', 'Business Continuity Program'),
    ('russian_employment_contract.md', 'text/markdown', 'Трудовой договор РФ'),
]

async def main():
    async with httpx.AsyncClient(timeout=120) as c:
        name = f'legal-contradiction-demo-{int(time.time())}'
        r = await c.post(f'{API}/projects', json={'name': name, 'description': 'Demo'})
        pid = r.json()['id']
        print(f'Project {pid}')

        doc_ids = {}
        for fname, mime, label in docs:
            with open(f'{DOCS_DIR}/{fname}', 'rb') as f:
                r = await c.post(f'{API}/projects/{pid}/documents', data={'display_name': label}, files={'file': (fname, f, mime)})
            if r.status_code not in (200, 201):
                print(f'  {label}: FAIL {r.status_code} {r.text}')
                sys.exit(1)
            did = r.json()['id']
            doc_ids[label] = (did, fname)
            print(f'  {label}: {did}')

        print('Indexing...')
        for label, (did, _) in doc_ids.items():
            dl = time.time() + 60
            while time.time() < dl:
                r = await c.get(f'{API}/projects/{pid}/documents/{did}')
                s = r.json()['status']
                if s in ('indexed','failed'): print(f'  {label}: {s}'); break
                await asyncio.sleep(2)

        russian_id = doc_ids['Трудовой договор РФ'][0]
        results_data = []
        for label, (did, _) in doc_ids.items():
            if did == russian_id: continue
            label_short = label[:35]
            r = await c.post(f'{API}/projects/{pid}/analysis/contradictions', json={'base_document_id': russian_id, 'target_document_ids': [did]})
            jid = r.json()['job_id']
            print(f'\nJob {jid}: vs {label_short}')
            dl = time.time() + 180
            while time.time() < dl:
                r = await c.get(f'{API}/projects/{pid}/analysis/contradictions/{jid}')
                if r.status_code != 200: await asyncio.sleep(3); continue
                job = r.json()
                if job['status'] in ('completed','failed'):
                    res = job.get('results') or []
                    n = sum(len(g.get('contradictions',[])) for g in (res if isinstance(res,list) else []))
                    print(f'  Status: {job["status"]}, contradictions: {n}')
                    for g in (res if isinstance(res,list) else []):
                        s = (g.get('summary') or '')[:250]
                        print(f'    {g.get("target_document_name","?")}: {s}')
                        for c in g.get('contradictions',[]):
                            print(f'      [{c.get("confidence",0)*100:.0f}%] {c.get("explanation","")[:200]}')
                    results_data.append({'pair': f'vs {label_short}', 'jid': jid, 'results': job})
                    break
                await asyncio.sleep(3)

        print(f'\n=== DONE pid={pid} ===')
        for rd in results_data:
            res = rd['results'].get('results') or []
            n = sum(len(g.get('contradictions',[])) for g in (res if isinstance(res,list) else []))
            print(f'{rd["pair"]}: {n}')

        with open(f'{DOCS_DIR}/contradiction_results.json', 'w', encoding='utf-8') as f:
            json.dump({'project_id': pid, 'pairs': results_data}, f, indent=2, ensure_ascii=False, default=str)

asyncio.run(main())
