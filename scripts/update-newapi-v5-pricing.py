#!/usr/bin/env python3
"""Preview/apply only the three V5 High billing expressions through NewAPI.

Credentials remain on the existing LFN host. No wallet mutation or generation.
Usage: python scripts/update-newapi-v5-pricing.py [--apply]
"""
import importlib.util
import json
import shlex
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REMOTE = r'''
const fs=require('fs'),path=require('path');
const root=path.resolve(process.env.LFN_DATA_DIR||'data');
const settings=JSON.parse(fs.readFileSync(path.join(root,'platform/config.json'),'utf8')).settings||{};
const base=(settings.newApiBaseUrl||process.env.NEWAPI_BASE_URL||'').replace(/\/+$/,'');
const headers={Authorization:settings.newApiAdminToken||process.env.LFN_ADMIN_TOKEN,'New-Api-User':String(settings.newApiAdminUserId||process.env.LFN_ADMIN_USER_ID||1),'Content-Type':'application/json'};
const targets=['nai-v5-full','nai-v5-curated','nai-v5-inpaint'];
const optionKey='billing_setting.billing_expr';
async function options(){const r=await fetch(base+'/api/option/',{headers,signal:AbortSignal.timeout(15000)});const p=await r.json();if(!r.ok||!p.success||!Array.isArray(p.data))throw Error('Unable to read NewAPI options');return Object.fromEntries(p.data.map(x=>[x.key,x.value]));}
async function put(value){const r=await fetch(base+'/api/option/',{method:'PUT',headers,body:JSON.stringify({key:optionKey,value:JSON.stringify(value)}),signal:AbortSignal.timeout(15000)});const p=await r.json();if(!r.ok||!p.success)throw Error('NewAPI expression update was not confirmed');}
(async()=>{
 const original=await options(), expressions=JSON.parse(original[optionKey]), modes=JSON.parse(original['billing_setting.billing_mode']);
 const policy=JSON.parse(fs.readFileSync(path.join(root,'daily-billing/policy.json'),'utf8'));
 const exchange=Number(policy.displayUsdPerCny||200), smallCny=0.04, smallBalance=Number((smallCny*exchange).toFixed(8));
 const next={...expressions}, plan=[];
 for(const model of targets){
  if(modes[model]!=='tiered_expr')throw Error('Unexpected V5 billing mode');
  const v45=model.replace('v5','v4.5');
  const found=String(expressions[v45]||'').match(/tier\("full",\s*p\s*\*\s*(\d+)/);
  if(!found)throw Error('Cannot derive the V4.5 dynamic coefficient');
  const dynamic=Number(found[1])*1.25, raw=smallBalance*1000000;
  if(!Number.isSafeInteger(dynamic)||!Number.isSafeInteger(raw))throw Error('Invalid price conversion');
  next[model]=`p < 100 ? tier("limit", p * 0 + c * 0 + ${raw}) : tier("full", p * ${dynamic} + c * 0)`;
  plan.push({model,before:expressions[model],after:next[model],smallCny,smallBalance,dynamicCoefficient:dynamic});
 }
 const output={applied:false,exchange,plan};
 if(APPLY){
  const backupDir=path.join(root,'pricing-backups');fs.mkdirSync(backupDir,{recursive:true});
  const backup=path.join(backupDir,'newapi-v5-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
  fs.writeFileSync(backup,JSON.stringify({key:optionKey,value:expressions},null,2),{mode:0o600,flag:'wx'});
  const check=await options();if(check[optionKey]!==original[optionKey])throw Error('Pricing changed during review; refusing overwrite');
  try{
   await put(next);const live=JSON.parse((await options())[optionKey]);
   if(JSON.stringify(live)!==JSON.stringify(next))throw Error('Pricing read-back mismatch');
   output.applied=true;output.backupCreated=true;output.untouchedModels=Object.keys(expressions).filter(x=>!targets.includes(x)).length;
  }catch(error){
   const live=JSON.parse((await options())[optionKey]);
   const restored={...live};for(const model of targets)restored[model]=expressions[model];
   await put(restored);throw error;
  }
 }
 console.log(JSON.stringify(output));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
'''


def main():
    if sys.argv[1:] not in ([], ['--apply']):
        raise SystemExit(__doc__)
    spec = importlib.util.spec_from_file_location('lfn_deploy', ROOT / 'scripts/deploy-paramiko.py')
    deploy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(deploy)
    client = deploy.connect()
    try:
        script = REMOTE.replace('if(APPLY)', 'if(' + ('true' if '--apply' in sys.argv else 'false') + ')')
        result = deploy.run_remote(client, 'docker exec love-for-nai node -e ' + shlex.quote(script), quiet=True)
        print(json.dumps(json.loads(result), ensure_ascii=False, indent=2))
    finally:
        client.close()


if __name__ == '__main__':
    main()
