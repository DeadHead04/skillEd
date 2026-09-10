"""Calibrate a synthetic product-review bundle through the actual sandboxed judge."""
import copy,json,os,pathlib,shutil,subprocess,sys,tempfile,zipfile
assert os.environ.get('SKILLED_SCRIPT_SANDBOX'), 'Sandbox must remain enabled'
bundle=pathlib.Path(sys.argv[1])
answers=json.loads(pathlib.Path(sys.argv[2]).read_text())
root=pathlib.Path(tempfile.mkdtemp(prefix='judge-calibration-',dir='/data/work'))
truth=root/'bundle'; truth.mkdir()
with zipfile.ZipFile(bundle) as archive:
    for entry in archive.infolist():
        target=(truth/entry.filename).resolve()
        assert truth in target.parents or target==truth
        archive.extract(entry,truth)
results=[]
try:
    for case_file in sorted((truth/'evals/cases').glob('*.yaml')):
        case=json.loads(case_file.read_text())
        original=answers[case['id']]
        for variant in ['valid','missing-output','wrong-decision','malformed-structure','changed-input','wrong-citation','empty-reason','extra-output-field','duplicate-review','wrong-order']:
            if variant=='wrong-order' and len(original['reviews'])<2: continue
            work=root/(case['id']+'-'+variant); work.mkdir()
            if case.get('context',{}).get('repo_fixture'):
                fixtures=(truth/case['context']['repo_fixture']).resolve()
                assert truth in fixtures.parents and fixtures.is_dir(), 'Pinned CLI fixture root must exist'
                shutil.copytree(fixtures,work,dirs_exist_ok=True)
            output=copy.deepcopy(original)
            if variant=='wrong-decision': output['reviews'][0]['decision']='FAIL' if output['reviews'][0]['decision']=='PASS' else 'PASS'
            if variant=='malformed-structure': output['reviews'][0]['findings']='not-an-array'
            if variant=='wrong-citation': next(r for r in output['reviews'] if r['findings'])['findings'][0]['source_id']='invented'
            if variant=='empty-reason': next(r for r in output['reviews'] if r['findings'])['findings'][0]['reason']=''
            if variant=='extra-output-field': output['unexpected']=True
            if variant=='duplicate-review': output['reviews'].append(copy.deepcopy(output['reviews'][0]))
            if variant=='wrong-order': output['reviews'].reverse()
            if variant!='missing-output': (work/'review.json').write_text(json.dumps(output))
            if variant=='changed-input':
                staged=next((work/'inputs').glob('*'))
                staged.write_bytes(staged.read_bytes()+b'\n')
            judge={**case['judge'],'script_path':str(truth/case['judge']['script_path'])}
            request=root/(case['id']+'-'+variant+'.json')
            result_path=root/(case['id']+'-'+variant+'-grade.json')
            request.write_text(json.dumps({'case_id':case['id'],'final_message':'review.json is ready','exit_code':0,'workspace_path':str(work),'judge':judge}))
            process=subprocess.run(['skill-up','debug','judge',str(request),'--output',str(result_path)],cwd=work,capture_output=True,text=True,timeout=45)
            assert process.returncode==0,(process.stdout,process.stderr)
            grading=json.loads(result_path.read_text())
            expected='PASS' if variant=='valid' else 'FAIL'
            record={'caseId':case['id'],'variant':variant,'expected':expected,'grading':grading}
            results.append(record)
            pathlib.Path(sys.argv[3]).write_text(json.dumps({'calibration':'synthetic known-good/bad outputs; no model calls','results':results},indent=2))
            assert grading['status']==expected,record
    pathlib.Path(sys.argv[3]).write_text(json.dumps({'calibration':'synthetic known-good/bad outputs; no model calls','results':results},indent=2))
    print(json.dumps({'calibration':'passed','checks':len(results)}))
finally:
    shutil.rmtree(root)
