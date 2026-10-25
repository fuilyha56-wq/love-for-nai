"""Verify deployed fees without sending a paid generation request."""
import importlib.util
import json
import shlex
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIRECTORY = ROOT / '.tmp-build/nai-parity-20261023'


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    modes = load('parity_modes_verify', ROOT / 'scripts/verify-nai-modes.py')
    modes.DIRECTORY = DIRECTORY
    sys.argv = [sys.argv[0], '--after']
    modes.main()
    deploy = load('parity_live_deploy', ROOT / 'scripts/deploy-paramiko.py')
    snapshot = load('parity_live_snapshot', ROOT / 'scripts/snapshot-nai-pricing-readonly.py')
    before = json.loads((DIRECTORY / 'pricing-before.json').read_text(encoding='utf-8'))
    plan = json.loads((ROOT / 'docs/nai-parity-pricing-proposal-2026-10-23.json').read_text(encoding='utf-8'))
    client = deploy.connect()
    try:
        after = json.loads(deploy.run_remote(client, 'docker exec love-for-nai node -e ' + shlex.quote(snapshot.REMOTE), quiet=True, timeout=90))
        options = after['options']
        assert after['dailyPolicy'] == before['dailyPolicy'], 'Daily policy changed'
        for key in ['GroupRatio', 'GroupGroupRatio', 'QuotaPerUnit']:
            assert options[key] == before['options'][key], key
        for row in plan['models']:
            model, price = row['model'], row['proposed']
            assert options['billing_setting.billing_expr'].get(model) == price['billingExpr'], model
            assert options['billing_setting.billing_mode'].get(model, 'ratio') == price['billingMode'], model
            assert options['ModelPrice'][model] == price['modelPrice'], model
        names = {x['model'] for x in plan['models']}
        for key in ['billing_setting.billing_expr', 'billing_setting.billing_mode', 'ModelPrice']:
            assert {k: v for k, v in options[key].items() if k not in names} == {k: v for k, v in before['options'][key].items() if k not in names}, key
        (DIRECTORY / 'pricing-after.json').write_text(json.dumps(after, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        _, out, err = client.exec_command('docker exec -i novelai-gateway python', timeout=90)
        out.channel.sendall((ROOT / 'scripts/.tmp/probe-nai-parity-gateway.py').read_bytes())
        out.channel.shutdown_write()
        raw, error = out.read().decode(), err.read().decode()
        if out.channel.recv_exit_status():
            raise RuntimeError(error)
        probe = json.loads(raw)
        assert probe['ok'] and probe['paidGenerations'] == 0
        # Evaluate the exact expressions read back from NewAPI against usage
        # emitted by the actual deployed handlers with mocked upstreams.
        js = 'const rows=' + json.dumps(probe['quotes']) + ',expr=' + json.dumps(options['billing_setting.billing_expr']) + ';for(const r of rows){const cost=new Function("p","c","tier","return "+expr[r.model])(Math.max(1,r.p),r.c,(_,v)=>v);const q=Math.round(cost/1e6*500000);if(q!==r.expectedAff*500000)throw Error(r.label+" quota mismatch");r.quota=q;r.cny=q/1e8;}console.log(JSON.stringify(rows));'
        checked = json.loads(deploy.run_remote(client, 'docker exec love-for-nai node -e ' + shlex.quote(js), quiet=True))
        public_script = "(async()=>{const r=await fetch('http://127.0.0.1:3000/api/public/catalog',{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Public catalog HTTP '+r.status);const p=await r.json();console.log(JSON.stringify(p));})().catch(e=>{console.error(e.message);process.exitCode=1});"
        catalog = json.loads(deploy.run_remote(client, 'docker exec love-for-nai node -e ' + shlex.quote(public_script), quiet=True, timeout=90))
        high = next(x for x in catalog['models'] if x['id'] == 'nai-v5-full')
        assert high['pricing']['liveUsdPerRequest'] == 5, high
        assert high['pricing']['liveBaseUsdPerImage'] == 5, high
        assert high['pricing']['liveUsdPerUsageToken'] == .1, high
        health = json.loads(deploy.run_remote(client, 'curl --fail --silent --max-time 30 http://127.0.0.1:41800/api/health', quiet=True, timeout=60))
        assert health['status'] == 'ok', health
        result = {'ok': True, 'appliedPrices': 14, 'dailyPolicyPreserved': True, 'newApiDailyTiers': False, 'groupRatiosPreserved': True, 'handlerPriceChecks': checked, 'publicHighPrice': high['pricing'], 'health': health, 'paidGenerations': 0}
        (DIRECTORY / 'live-verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({'ok': True, 'appliedPrices': 14, 'compiledQuoteCases': 17, 'handlerPriceCases': len(checked), 'paidGenerations': 0}))
    finally:
        client.close()


if __name__ == '__main__':
    main()
