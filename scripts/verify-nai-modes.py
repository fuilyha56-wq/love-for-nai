"""Read-only compiled LFN / Gateway quote comparison. Never generates images."""
import argparse
import base64
import importlib.util
import json
import shlex
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIRECTORY = ROOT / '.tmp-build/nai-operations-20261023'


def cases():
    encoded = base64.b64encode(bytes(2000)).decode()
    defaults = dict(model='nai-v5-full', width=2048, height=1536, steps=28, samples=1)
    rows = []
    def add(label, operation, expected, **overrides):
        generation = {**defaults, 'operation': operation, **overrides}
        action = 'img2img' if operation == 'img2img' else 'infill' if operation in ('inpainting', 'edits', 'outpainting') else 'generate'
        params = {k: generation[k] for k in ('width', 'height', 'steps')}
        params['n_samples'] = generation['samples']
        if 'strength' in overrides:
            params['inpaintImg2ImgStrength' if action == 'infill' else 'strength'] = overrides['strength']
        if action != 'generate':
            params['image'] = 'fixture-image'
        if action == 'infill':
            params['mask'] = 'fixture-mask'
            params['strength'] = 0.2  # unrelated slider must not discount infill
        vibe = generation.get('vibeReferenceImageCount', 0)
        precise = generation.get('preciseReferenceImageCount', 0)
        if vibe:
            params['reference_image_multiple'] = [encoded] * generation.get('encodedVibeCount', 0) + ['raw'] * (vibe - generation.get('encodedVibeCount', 0))
        if precise:
            params['director_reference_images'] = ['ref'] * precise
        generation['referenceImageCount'] = precise or vibe
        generation['referenceMode'] = 'precise' if precise else 'vibe'
        # Default semantics used by the studio / external request parser.
        if action == 'img2img':
            generation.setdefault('strength', 0.7)
        if action == 'infill':
            generation.setdefault('strength', 1)
        body = {'model': generation['model'], 'action': action, 'parameters': params}
        rows.append(dict(label=label, generation=generation, native=body, expectedAnlas=expected))
    add('文生图', 'generate', 90)
    add('图生图默认强度 0.7', 'img2img', 63)
    add('图生图强度 0.55', 'img2img', 50, strength=0.55)
    add('图生图强度 0', 'img2img', 2, strength=0)
    add('局部重绘默认强度 1', 'inpainting', 90)
    add('编辑强度 0.55', 'edits', 50, strength=0.55)
    add('扩图强度 0.55', 'outpainting', 50, strength=0.55)
    add('V4.5 图生图默认强度', 'img2img', 42, model='nai-v4.5-full')
    add('Medium 图生图默认强度', 'img2img', 36, model='nai-v5-full-medium', steps=14)
    add('Vibe 一张新参考图', 'vibe-transfer', 92, vibeReferenceImageCount=1)
    add('Vibe 一张缓存参考图', 'vibe-transfer', 90, vibeReferenceImageCount=1, encodedVibeCount=1)
    add('角色参考一张新图', 'character-reference', 92, vibeReferenceImageCount=1)
    add('精准参考一张', 'precise-reference', 95, preciseReferenceImageCount=1)
    add('五张缓存 Vibe', 'vibe-transfer', 28, width=1024, height=1024, steps=23, vibeReferenceImageCount=5, encodedVibeCount=5)
    add('图生图同请求两张', 'img2img', 126, samples=2)
    add('精准参考同请求两张', 'precise-reference', 190, samples=2, preciseReferenceImageCount=1)
    add('Vibe 同请求两张', 'vibe-transfer', 182, samples=2, vibeReferenceImageCount=1)
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--after', action='store_true')
    parser.add_argument('--local-image', help='Verify a prepared local image and the local Gateway, with no remote changes')
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location('deploy_modes_verify', ROOT / 'scripts/deploy-paramiko.py')
    deploy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(deploy)
    rows = cases()
    script = (ROOT / 'scripts/.tmp/probe-nai-production.cjs').read_text(encoding='utf-8').split('const cases = [', 1)[0]
    script += '\nconst rows = ' + json.dumps(rows, ensure_ascii=True) + ';\n'
    script += 'console.log(JSON.stringify(rows.map(row=>({label:row.label,...quote(row.generation,policy,.005,0)}))));'
    py = 'import json;from src.proxy.openai import native_anlas_quote;rows=json.loads(' + repr(json.dumps(rows)) + ');print(json.dumps([native_anlas_quote("/ai/generate-image",r["native"]) for r in rows]))'
    client = None if args.local_image else deploy.connect()
    try:
        if args.local_image:
            lfn = json.loads(subprocess.run(['docker', 'run', '--rm', '-i', '--network', 'none', '--entrypoint', 'node', args.local_image], input=script, text=True, encoding='utf-8', capture_output=True, check=True).stdout)
            gateway_root = ROOT.parent / 'novelai-gateway'
            gateway = json.loads(subprocess.run([str(gateway_root / '.venv/Scripts/python.exe'), '-c', py], cwd=gateway_root, text=True, encoding='utf-8', capture_output=True, check=True).stdout)
        else:
            _, out, err = client.exec_command('docker exec -i love-for-nai node', timeout=90)
            channel = out.channel
            channel.sendall(script.encode())
            channel.shutdown_write()
            lfn = out.read().decode()
            error = err.read().decode()
            if channel.recv_exit_status():
                raise RuntimeError(error)
            lfn = json.loads(lfn)
            gateway = json.loads(deploy.run_remote(client, 'docker exec novelai-gateway python -c ' + shlex.quote(py), quiet=True))
        result = []
        for row, aff, quote in zip(rows, lfn, gateway):
            if args.after or args.local_image:
                assert quote == [row['expectedAnlas'], row['expectedAnlas'] * 50], (row['label'], quote)
                assert abs(aff['anlas'] - row['expectedAnlas']) < 1e-8, (row['label'], aff)
            result.append({**row, 'lfn': aff, 'gatewayAnlas': quote[0], 'gatewayPromptTokens': quote[1]})
        output = {'ok': True, 'after': args.after, 'localImage': args.local_image, 'paidGenerations': 0, 'cases': result}
        (DIRECTORY / ('modes-proposed.json' if args.local_image else 'modes-after.json' if args.after else 'modes-before.json')).write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({'ok': True, 'cases': len(result), 'paidGenerations': 0, 'quotes': [{'label': x['label'], 'gatewayAnlas': x['gatewayAnlas'], 'aff': x['lfn']['costAff']} for x in result]}, ensure_ascii=False, indent=2))
    finally:
        if client:
            client.close()


if __name__ == '__main__':
    main()
