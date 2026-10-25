"""Validate the parity prices using NewAPI's read-only model pricing preview."""
import importlib.util
import json
import shlex
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIRECTORY = ROOT / '.tmp-build/nai-parity-20261023'
REMOTE = r'''
const fs=require('fs'),path=require('path'),rows=PLAN;
const s=JSON.parse(fs.readFileSync(path.resolve(process.env.LFN_DATA_DIR||'data','platform/config.json'),'utf8')).settings||{};
const base=(s.newApiBaseUrl||process.env.NEWAPI_BASE_URL||'').replace(/\/+$/,'');
const headers={Authorization:s.newApiAdminToken||process.env.LFN_ADMIN_TOKEN,'New-Api-User':String(s.newApiAdminUserId||process.env.LFN_ADMIN_USER_ID||1),'Content-Type':'application/json'};
(async()=>{
 const out=[];
 for(const row of rows){
  const p=row.proposed,pricing={'billing_setting.billing_mode':p.billingMode,ModelPrice:p.modelPrice};
  if(p.billingExpr!==null)pricing['billing_setting.billing_expr']=p.billingExpr;
  const r=await fetch(base+'/api/option/model_pricing/preview',{method:'POST',headers,body:JSON.stringify({model_name:row.model,pricing}),signal:AbortSignal.timeout(15000)});
  const result=await r.json();
  if(!r.ok||!result.success)throw Error('Price preview failed for '+row.model+': '+JSON.stringify(result));
  out.push({model:row.model,preview:result.data});
 }
 console.log(JSON.stringify({ok:true,mutated:false,rows:out}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
'''


def main():
    spec = importlib.util.spec_from_file_location('parity_preview_deploy', ROOT / 'scripts/deploy-paramiko.py')
    deploy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(deploy)
    plan = json.loads((ROOT / 'docs/nai-parity-pricing-proposal-2026-10-23.json').read_text(encoding='utf-8'))
    client = deploy.connect()
    try:
        script = REMOTE.replace('PLAN', json.dumps(plan['models']))
        output = json.loads(deploy.run_remote(client, 'docker exec love-for-nai node -e ' + shlex.quote(script), quiet=True, timeout=180))
        (DIRECTORY / 'engine-preview.json').write_text(json.dumps(output, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({'ok': output['ok'], 'validPrices': len(output['rows']), 'mutated': False}))
    finally:
        client.close()


if __name__ == '__main__':
    main()
