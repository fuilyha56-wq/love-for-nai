"""Read only NewAPI price options and LFN's daily policy; never changes remote state."""
import importlib.util
import json
import shlex
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REMOTE = r'''
const fs=require('fs'),path=require('path');
const root=path.resolve(process.env.LFN_DATA_DIR||'data');
const settings=JSON.parse(fs.readFileSync(path.join(root,'platform/config.json'),'utf8')).settings||{};
const base=(settings.newApiBaseUrl||process.env.NEWAPI_BASE_URL||'').replace(/\/+$/,'');
const headers={Authorization:settings.newApiAdminToken||process.env.LFN_ADMIN_TOKEN,'New-Api-User':String(settings.newApiAdminUserId||process.env.LFN_ADMIN_USER_ID||1)};
function parse(value){try{return JSON.parse(value);}catch{return value;}}
function naiOnly(value){return value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).filter(([name])=>/^nai-|novelai/i.test(name))):value;}
(async()=>{
 const response=await fetch(base+'/api/option/',{headers,signal:AbortSignal.timeout(15000)}),payload=await response.json();
 if(!response.ok||!payload.success||!Array.isArray(payload.data))throw Error('Unable to read pricing options');
 const options=Object.fromEntries(payload.data.map(x=>[x.key,x.value])), selected={};
 const modelKeys=['billing_setting.billing_expr','billing_setting.billing_mode','ModelPrice','ModelRatio','CompletionRatio'];
 const commonKeys=['GroupRatio','GroupGroupRatio','QuotaPerUnit','DisplayInCurrency','DisplayTokenStatEnabled','USDExchangeRate','QuotaDisplayType'];
 for(const key of modelKeys)if(key in options)selected[key]=naiOnly(parse(options[key]));
 for(const key of commonKeys)if(key in options)selected[key]=parse(options[key]);
 for(const key of Object.keys(options))if(/^(ratio_setting\.)?(group_ratio|group_group_ratio)$/.test(key))selected[key]=parse(options[key]);
 const statusResponse=await fetch(base+'/api/status',{signal:AbortSignal.timeout(15000)}),statusPayload=await statusResponse.json();
 const status=statusPayload.data||{},statusPricing={};
 for(const [key,value] of Object.entries(status))if(/quota_per_unit|usd_exchange_rate|display_in_currency|quota_display_type/i.test(key))statusPricing[key]=value;
 const policyFile=path.join(root,'daily-billing/policy.json');
 const policy=fs.existsSync(policyFile)?JSON.parse(fs.readFileSync(policyFile,'utf8')):null;
 const pricingResponse=await fetch(base+'/api/pricing',{headers,signal:AbortSignal.timeout(15000)}),pricingPayload=await pricingResponse.json();
 if(!pricingResponse.ok||!Array.isArray(pricingPayload.data))throw Error('Unable to read model price catalog');
 const modelCatalog=pricingPayload.data.filter(x=>/^nai-/.test(x.model_name||'')).map(x=>Object.fromEntries(['model_name','enable_groups','quota_type','model_price','billing_mode','billing_expr'].filter(k=>k in x).map(k=>[k,x[k]])));
 const relevantGroups=new Set(['default',...modelCatalog.flatMap(x=>x.enable_groups||[])]);
 if(selected.GroupRatio)selected.GroupRatio=Object.fromEntries(Object.entries(selected.GroupRatio).filter(([name])=>relevantGroups.has(name)));
 console.log(JSON.stringify({capturedAt:new Date().toISOString(),options:selected,statusPricing,dailyPolicy:policy,modelCatalog}));
})().catch(()=>{console.error('Read-only pricing snapshot failed; no remote mutation attempted');process.exitCode=1;});
'''

def main():
    spec = importlib.util.spec_from_file_location('lfn_deploy', ROOT / 'scripts/deploy-paramiko.py')
    deploy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(deploy)
    client = deploy.connect()
    try:
        result = deploy.run_remote(client, 'docker exec love-for-nai node -e ' + shlex.quote(REMOTE), timeout=90, quiet=True)
        data = json.loads(result)
        destination = ROOT / 'docs' / 'nai-pricing-live-snapshot-2026-10-22.json'
        destination.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
        print(json.dumps(data, ensure_ascii=False, indent=2))
    finally:
        client.close()

if __name__ == '__main__':
    main()
