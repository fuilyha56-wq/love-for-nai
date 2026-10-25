"""Overlay only audited API fixes onto the recovered, deployed build context."""
import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIRECTORY = ROOT / '.tmp-build/nai-api-coverage-20261024'
CONTEXT = DIRECTORY / 'context'
FILES = [
    'src/lib/compat-api.ts',
    'src/app/v1/images/generations/route.ts',
    'src/app/v1/images/edits/route.ts',
    'src/app/ai/encode-vibe/route.ts',
]

def hashes():
    return {p.relative_to(CONTEXT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in CONTEXT.rglob('*') if p.is_file()}

if __name__ == '__main__':
    manifest_file = DIRECTORY / 'baseline-source-hashes.json'
    if manifest_file.exists():
        before = json.loads(manifest_file.read_text(encoding='utf-8'))
    else:
        before = hashes()
        previous = json.loads((ROOT / '.tmp-build/nai-parity-20261023/source-hashes.json').read_text(encoding='utf-8'))
        for file, expected in previous.items():
            source = Path(file)
            if source.is_relative_to(ROOT):
                name = source.relative_to(ROOT).as_posix()
                if before.get(name) != expected:
                    raise RuntimeError('Recovered source differs from deployed release: ' + name)
        manifest_file.write_text(json.dumps(before, indent=2) + '\n', encoding='utf-8')
    for name in FILES:
        shutil.copy2(ROOT / name, CONTEXT / name)
    after = hashes()
    changed = sorted(name for name in set(before) | set(after) if before.get(name) != after.get(name))
    if changed != sorted(FILES):
        raise RuntimeError('Unexpected release files: ' + repr(changed))
    (DIRECTORY / 'release-source-hashes.json').write_text(json.dumps({name: {'before': before[name], 'after': after[name]} for name in changed}, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'baseImage': 'love-for-nai:nai-parity-20261023-r1', 'changedFiles': changed}, indent=2))
