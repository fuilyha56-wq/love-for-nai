"""Run the actual reset transform on a disposable filesystem; no SSH required."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('reset_marks',Path(__file__).resolve().parents[1]/'scripts/reset-risk-marks.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class RiskMarkResetTest(unittest.TestCase):
    def test_partial_write_failure_restores_every_original_and_never_marks_reset_complete(self):
        with tempfile.TemporaryDirectory(prefix='lfn-marks-rollback-') as directory:
            risk=Path(directory)/'risk';risk.mkdir()
            original={'cases.json':[{'userId':1,'score':200}],'events.json':[{'id':'keep'}],'prompt-clusters.json':[{'id':'keep'}]}
            for file,value in original.items():(risk/file).write_text(json.dumps(value),encoding='utf-8')
            (risk/'prompt-clusters.json.reset-test-release').write_text('collision',encoding='utf-8')
            script=module.RESET_SCRIPT.replace('RESET_ID',json.dumps('test-release')).replace('APPLY','true')
            result=subprocess.run(['node','-e',script],env={**os.environ,'LFN_DATA_DIR':directory},capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            for file,value in original.items():self.assertEqual(json.loads((risk/file).read_text()),value)
            self.assertFalse((risk/'marks-reset.json').exists())

    def test_backup_reset_and_repetition_preserve_billing_grants_and_manual_bans(self):
        with tempfile.TemporaryDirectory(prefix='lfn-marks-reset-') as directory:
            root=Path(directory)
            fixtures={
                'risk/cases.json':[{'userId':1,'signals':[{'id':'old'}],'score':200}, {'userId':2,'signals':[{'id':'manual'}],'score':100,'enforcement':{'blocked':True,'blockReason':'manual ban'}}],
                'risk/events.json':[{'id':'old'}],
                'risk/prompt-clusters.json':[{'id':'old'}],
                'risk/actions.json':[{'action':'mark-risk'},{'action':'ban-user'}],
                'risk/light/user-1.json':{'evidence':[{'id':'old'}],'restrictions':[{'id':'old'}],'applied':{'old':1},'baseline':{'old':2}},
                'risk/light/grants/1-2026-10-18.json':{'exits':1},
                'risk/settlements.json':[{'userId':1,'chargedAmount':4}],
                'aff/1.json':{'balance':999},
                'request-audit/index.json':{'records':[{'requestId':'keep'}]},
                'risk/settings-v2.json':{'version':'keep'},
            }
            for file,value in fixtures.items():
                target=root/file;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(value),encoding='utf-8')
            def execute(apply):
                script=module.RESET_SCRIPT.replace('RESET_ID',json.dumps('test-release')).replace('APPLY','true' if apply else 'false')
                result=subprocess.run(['node','-e',script],env={**os.environ,'LFN_DATA_DIR':directory},capture_output=True,text=True,check=True)
                return json.loads(result.stdout)
            self.assertFalse(execute(False)['changed'])
            applied=execute(True);self.assertTrue(applied['backupCreated']);self.assertEqual(applied['manualBansPreserved'],1)
            for file in ['aff/1.json','risk/settlements.json','request-audit/index.json','risk/settings-v2.json','risk/light/grants/1-2026-10-18.json']:
                self.assertEqual(json.loads((root/file).read_text()),fixtures[file])
            self.assertEqual(json.loads((root/'risk/light/user-1.json').read_text())['evidence'],[])
            self.assertEqual(json.loads((root/'risk/light/user-1.json').read_text())['restrictions'],[])
            self.assertEqual(json.loads((root/'risk/cases.json').read_text())[0]['enforcement'],fixtures['risk/cases.json'][1]['enforcement'])
            self.assertEqual(json.loads((root/'risk/mark-backups/test-release/cases.json').read_text()),fixtures['risk/cases.json'])
            self.assertTrue(execute(True)['alreadyReset'])

if __name__=='__main__':unittest.main()
