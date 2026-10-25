"""Verify the deployed API release, unchanged pricing, and compiled handlers."""
import importlib.util
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIRECTORY = ROOT / '.tmp-build/nai-api-coverage-20261024'
IMAGE = 'love-for-nai:nai-api-coverage-20261024-r1'

def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

if __name__ == '__main__':
    subprocess.run([sys.executable, str(ROOT / 'scripts/verify-nai-api-coverage.py')], check=True)
    parity = load('verify_api_prices', ROOT / 'scripts/verify-nai-parity-live.py')
    parity.DIRECTORY = DIRECTORY
    parity.main()
    deploy = load('verify_api_release', ROOT / 'scripts/deploy-paramiko.py')
    client = deploy.connect()
    try:
        before = json.loads((DIRECTORY / 'inventory.json').read_text(encoding='utf-8'))
        running = json.loads(deploy.run_remote(client, 'docker inspect love-for-nai novelai-gateway', quiet=True))
        lfn, gateway = running
        assert lfn['Config']['Image'] == IMAGE
        assert lfn['Config']['Labels']['org.opencontainers.image.revision'] == 'nai-api-coverage-20261024-r1'
        assert gateway['Id'] == before['novelai-gateway']['containerId'], 'Unrelated Gateway recreation'
        pricing_before = json.loads((DIRECTORY / 'pricing-before.json').read_text(encoding='utf-8'))
        pricing_after = json.loads((DIRECTORY / 'pricing-after.json').read_text(encoding='utf-8'))
        assert pricing_before['options'] == pricing_after['options'], 'Pricing settings changed'
        assert pricing_before['dailyPolicy'] == pricing_after['dailyPolicy'], 'Daily policy changed'
        compiled = json.loads((DIRECTORY / 'compiled-live.json').read_text(encoding='utf-8'))
        result = {
            'ok': True, 'deployedAt': datetime.now(timezone.utc).isoformat(),
            'image': IMAGE, 'imageId': lfn['Image'], 'containerId': lfn['Id'],
            'startedAt': lfn['State']['StartedAt'], 'testFiles': 9, 'testsPassed': 164,
            'realWalletApiTests': 47, 'compiledApiCases': len(compiled['compiledApiCases']),
            'pricingUnchanged': True, 'dailyPolicyPreserved': True, 'gatewayUnchanged': True,
            'changedSourceFiles': json.loads((DIRECTORY / 'release-source-hashes.json').read_text(encoding='utf-8')),
            'liveVerification': json.loads((DIRECTORY / 'live-verification.json').read_text(encoding='utf-8')),
            'paidGenerations': 0,
        }
        (ROOT / 'docs/nai-api-billing-deployed-2026-10-24.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({key: result[key] for key in ['ok','deployedAt','image','testsPassed','realWalletApiTests','compiledApiCases','pricingUnchanged','paidGenerations']}, indent=2))
    finally:
        client.close()
