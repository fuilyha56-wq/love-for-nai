"""Preview or apply the reviewed NAI expressions; credentials stay on the host.

python scripts/apply-nai-mode-pricing.py
python scripts/apply-nai-mode-pricing.py --apply
python scripts/apply-nai-mode-pricing.py --rollback <backup-filename.json>
"""
import importlib.util
import json
import re
import shlex
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REMOTE = r'''
const fs=require('fs'),path=require('path');
const plan=REVIEWED_PLAN,action=ACTION,backupName=BACKUP_NAME;
const root=path.resolve(process.env.LFN_DATA_DIR||'data');
const settings=JSON.parse(fs.readFileSync(path.join(root,'platform/config.json'),'utf8')).settings||{};
const base=(settings.newApiBaseUrl||process.env.NEWAPI_BASE_URL||'').replace(/\/+$/,'');
const headers={Authorization:settings.newApiAdminToken||process.env.LFN_ADMIN_TOKEN,'New-Api-User':String(settings.newApiAdminUserId||process.env.LFN_ADMIN_USER_ID||1),'Content-Type':'application/json'};
const ek='billing_setting.billing_expr',mk='billing_setting.billing_mode';
const targets=plan.models.filter(x=>JSON.stringify(x.before)!==JSON.stringify(x.proposed));
async function options(){const r=await fetch(base+'/api/option/',{headers,signal:AbortSignal.timeout(15000)}),p=await r.json();if(!r.ok||!p.success||!Array.isArray(p.data))throw Error('Cannot read pricing options');return Object.fromEntries(p.data.map(x=>[x.key,x.value]));}
async function put(key,value){const r=await fetch(base+'/api/option/',{method:'PUT',headers,body:JSON.stringify({key,value:JSON.stringify(value)}),signal:AbortSignal.timeout(15000)}),p=await r.json();if(!r.ok||!p.success)throw Error('Pricing update not confirmed');}
const decode=(o,k)=>JSON.parse(o[k]||'{}');
function matches(o,row,version){const p=row[version],expr=decode(o,ek),modes=decode(o,mk),prices=decode(o,'ModelPrice');return (modes[row.model]||'ratio')===p.billingMode&&(expr[row.model]??null)===p.billingExpr&&Number(prices[row.model])===p.modelPrice;}
function select(map){return Object.fromEntries(targets.map(x=>[x.model,map[x.model]??null]));}
function merge(current,selected){const next={...current};for(const [model,value]of Object.entries(selected)){if(value===null)delete next[model];else next[model]=value;}return next;}
async function restore(saved){
 let current=await options();
 await put(mk,merge(decode(current,mk),saved.beforeModes));
 current=await options();await put(ek,merge(decode(current,ek),saved.beforeExpressions));
 current=await options();
 if(JSON.stringify(select(decode(current,mk)))!==JSON.stringify(saved.beforeModes)||JSON.stringify(select(decode(current,ek)))!==JSON.stringify(saved.beforeExpressions))throw Error('Pricing rollback read-back mismatch');
}
(async()=>{
 if(targets.length!==8||targets.some(x=>!/^nai-v(?:4\.5|5)-(?:full|curated|inpaint)(?:-medium)?$/.test(x.model)))throw Error('Unexpected reviewed model scope');
 const original=await options(),directory=path.join(root,'pricing-backups');
 if(action==='rollback'){
  const saved=JSON.parse(fs.readFileSync(path.join(directory,backupName),'utf8'));
  if(!targets.every(x=>matches(original,x,'proposed'))&&!targets.every(x=>matches(original,x,'before')))throw Error('Pricing changed since deployment; refusing rollback overwrite');
  await restore(saved);console.log(JSON.stringify({rolledBack:true,models:targets.map(x=>x.model)}));return;
 }
 const policy=JSON.parse(fs.readFileSync(path.join(root,'daily-billing/policy.json'),'utf8'));
 if(Number(original.QuotaPerUnit)!==plan.quotaPerUnit||policy.displayUsdPerCny!==plan.balanceUnitsPerCny||policy.v45AnlasCny!==plan.normalAnlasCny||policy.v5AnlasCny!==plan.v5AnlasCny)throw Error('Live currency conversion differs from reviewed prices');
 const groups=decode(original,'GroupRatio');for(const [name,ratio]of Object.entries(plan.groups))if(groups[name]!==ratio)throw Error('Live image group ratio changed since review');
 if(plan.models.every(x=>matches(original,x,'proposed'))){console.log(JSON.stringify({applied:action==='apply',alreadyCurrent:true,changedModels:0}));return;}
 if(!plan.models.every(x=>matches(original,x,'before')))throw Error('Live model pricing changed since review; refusing overwrite');
 const expr=decode(original,ek),modes=decode(original,mk),nextExpr={...expr},nextModes={...modes};
 for(const row of targets){nextExpr[row.model]=row.proposed.billingExpr;nextModes[row.model]=row.proposed.billingMode;}
 const output={applied:false,changedModels:targets.map(x=>({model:x.model,before:x.before,after:x.proposed}))};
 if(action==='apply'){
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const name='newapi-nai-modes-20261023-'+Date.now()+'.json';
  const saved={createdAt:new Date().toISOString(),beforeModes:select(modes),beforeExpressions:select(expr),originalModes:modes,originalExpressions:expr};
  fs.writeFileSync(path.join(directory,name),JSON.stringify(saved,null,2),{flag:'wx',mode:0o600});
  const check=await options();if(check[ek]!==original[ek]||check[mk]!==original[mk])throw Error('Pricing changed during preparation');
  try{
   await put(ek,nextExpr);await put(mk,nextModes);
   const live=await options();if(!plan.models.every(x=>matches(live,x,'proposed')))throw Error('Pricing read-back mismatch');
   output.applied=true;output.backupName=name;
  }catch(error){await restore(saved);throw error;}
 }
 console.log(JSON.stringify(output));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
'''


def main():
    arguments = sys.argv[1:]
    action, backup = 'preview', ''
    if arguments == ['--apply']:
        action = 'apply'
    elif len(arguments) == 2 and arguments[0] == '--rollback' and re.fullmatch(r'newapi-nai-modes-20261023-\d+\.json', arguments[1]):
        action, backup = 'rollback', arguments[1]
    elif arguments:
        raise SystemExit(__doc__)
    plan = json.loads((ROOT / 'docs/nai-mode-pricing-proposal-2026-10-23.json').read_text(encoding='utf-8'))
    spec = importlib.util.spec_from_file_location('lfn_deploy', ROOT / 'scripts/deploy-paramiko.py')
    deploy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(deploy)
    script = REMOTE.replace('REVIEWED_PLAN', json.dumps(plan, ensure_ascii=True)).replace('ACTION', json.dumps(action)).replace('BACKUP_NAME', json.dumps(backup))
    client = deploy.connect()
    try:
        output = json.loads(deploy.run_remote(client, 'docker exec love-for-nai node -e ' + shlex.quote(script), quiet=True, timeout=120))
        directory = ROOT / '.tmp-build/nai-operations-20261023'
        directory.mkdir(parents=True, exist_ok=True)
        (directory / ('newapi-' + action + '-result.json')).write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(output, ensure_ascii=False, indent=2))
    finally:
        client.close()


if __name__ == '__main__':
    main()
