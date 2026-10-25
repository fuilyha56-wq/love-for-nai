"""Check the compiled API parser and prices without generating or spending."""
import argparse
import importlib.util
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIRECTORY = ROOT / '.tmp-build/nai-api-coverage-20261024'

CHECKS = r'''
const normalize=await exported('normalizeExternalImageBody'),parse=await exported('externalGeneration'),credit=await exported('imageCreditCost');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN3cAAAAASUVORK5CYII=','base64');
png.writeUInt32BE(2048,16);png.writeUInt32BE(1536,20);
const base={model:'nai-v5-full',size:'2048x1536',steps:28,prompt:'read-only billing verification'};
const checks=[
 ['V5 text',base,{},undefined,455],
 ['V4.5 text',{...base,model:'nai-v4.5-full'},{},undefined,241],
 ['img2img default',{...base,novelai_operation:'img2img',image:'fixture'},{},undefined,320],
 ['img2img string strength',{...base,novelai_operation:'img2img',image:'fixture',strength:'0.55'},{},undefined,255],
 ['edits string strength',{...base,inpaintImg2ImgStrength:'0.55',image:'fixture'},{},'edits',255],
 ['Medium img2img',{...base,model:'nai-v5-full-medium',steps:14,novelai_operation:'img2img',image:'fixture'},{},undefined,181],
 ['uncond_scale string',{...base,uncond_scale:'0.5'},{},undefined,230],
 ['header overrides',{...base,size:'1024x1024',steps:23,extra_params:{steps:26}},{'x-novelai-extra-params':JSON.stringify({width:2048,height:1536,steps:27}),'x-steps':'28'},undefined,455],
 ['header operation',{...base,image:'fixture',strength:.55},{'x-novelai-operation':'img2img'},undefined,255],
 ['actual PNG upscale',{...base,size:'1024x1024',width:1024,height:1024,novelai_operation:'upscale',image:png.toString('base64')},{},undefined,20],
 ['five cached vibes',{...base,size:'1024x1024',steps:23,reference_image_multiple_cached:Array.from({length:5},()=>({cache_secret_key:'cached-fixture'}))},{},undefined,145],
];
const result=checks.map(([label,body,headers,operation,expected])=>{
 const normalized=normalize(body,new Headers(headers),operation==='edits');
 const generation=operation?parse(normalized,operation):parse(normalized);
 assert(generation,label+' invalid generation');
 const amount=quote(generation,policy,.005,0)?.costAff??credit(generation);
 assert.equal(amount,expected,label);
 return {label,aff:amount,cny:amount*.005};
});
const limited=normalize({...base,model:'nai-v5-full-limit',size:'1024x1024'},new Headers({'x-novelai-extra-params':JSON.stringify({width:2048,height:1536})}));
assert.equal(parse(limited),null,'Limit must reject oversized override');
console.log(JSON.stringify({ok:true,compiledApiCases:result,limitOverrideRejected:true,paidGenerations:0}));
'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--local-image')
    args = parser.parse_args()
    prefix = (ROOT / 'scripts/.tmp/probe-nai-production.cjs').read_text(encoding='utf-8').split('const cases = [', 1)[0]
    prefix = prefix.replace("server/app/api/images/generate/route.js", "server/app/v1/images/generations/route.js")
    start, end = prefix.index('function exported(name)'), prefix.index('const quote =')
    prefix = prefix[:start] + r'''
async function exported(name) {
  for (const item of factories.filter(x=>x.source.includes('"'+name+'",0,'))) {
    // Turbopack can merge several source modules into one factory and register
    // their export tables under explicit IDs in e.s([...], moduleId).
    const ids=new Set([item.id,...Array.from(item.source.matchAll(/\],(\d+)\)/g),match=>Number(match[1]))]);
    for(const id of ids) {
      const module=await runtime.m(id).exports;
      if(typeof module[name]==='function') return module[name];
    }
  }
  throw Error('Compiled function missing: '+name);
}
''' + prefix[end:]
    prefix = prefix.replace("const quote = exported(", "const quote = await exported(").replace("const sizeError = exported(", "const sizeError = await exported(")
    script = "(async()=>{globalThis.AsyncLocalStorage=require('node:async_hooks').AsyncLocalStorage;\n" + prefix + CHECKS + "\n})().catch(error=>{console.error(error);process.exitCode=1;});"
    if args.local_image:
        result = subprocess.run(['docker', 'run', '--rm', '--pull', 'never', '-i', '--network', 'none', '--entrypoint', 'node', args.local_image], input=script, text=True, encoding='utf-8', capture_output=True)
        if result.returncode:
            raise RuntimeError(result.stderr[-4000:])
        value = json.loads(result.stdout)
    else:
        spec = importlib.util.spec_from_file_location('deploy_api_verify', ROOT / 'scripts/deploy-paramiko.py')
        deploy = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(deploy)
        client = deploy.connect()
        try:
            _, out, err = client.exec_command('docker exec -i love-for-nai node', timeout=90)
            out.channel.sendall(script.encode())
            out.channel.shutdown_write()
            raw, error = out.read().decode(), err.read().decode()
            if out.channel.recv_exit_status():
                raise RuntimeError(error)
            value = json.loads(raw)
        finally:
            client.close()
    (DIRECTORY / ('compiled-local.json' if args.local_image else 'compiled-live.json')).write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(value, indent=2))
