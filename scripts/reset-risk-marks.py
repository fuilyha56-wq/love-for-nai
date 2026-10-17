#!/usr/bin/env python3
"""Preview or reset risk marks with a private backup and stopped application.
Usage: python scripts/reset-risk-marks.py <release-tag> [--apply]
Preserves wallet/usage/history, daily grants, policies and manual bans.
"""
import importlib.util
import json
import re
import shlex
import sys
from pathlib import Path

RESET_SCRIPT = r'''
const fs=require('fs'),path=require('path');
const root=path.resolve(process.env.LFN_DATA_DIR||'data'),risk=path.join(root,'risk');
const read=(file,fallback)=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):fallback;
const marker=path.join(risk,'marks-reset.json');
if(read(marker,{}).resetId===RESET_ID){console.log(JSON.stringify({changed:false,alreadyReset:true}));process.exit(0);}
const cases=read(path.join(risk,'cases.json'),[]),actions=read(path.join(risk,'actions.json'),[]);
if(!Array.isArray(cases)||!Array.isArray(actions))throw Error('Unexpected risk store');
const light=path.join(risk,'light'),users=fs.existsSync(light)?fs.readdirSync(light).filter(x=>/^user-\d+\.json$/.test(x)):[];
const now=new Date().toISOString(), kept=cases.filter(x=>x.enforcement?.blocked===true);
const changes=new Map([
 [path.join(risk,'cases.json'),kept.map(x=>({...x,signals:[],score:0,level:'banned',promptClusterIds:[],relatedRequestIds:[],firstSeenAt:now,lastSeenAt:now}))],
 [path.join(risk,'events.json'),[]],[path.join(risk,'prompt-clusters.json'),[]],
 [path.join(risk,'actions.json'),actions.filter(x=>!['mark-risk','mark-false-positive'].includes(x.action))],
 [marker,{resetId:RESET_ID,at:now,reason:'Administrator requested a fresh risk observation period'}]
]);
let evidence=0,restrictions=0;
for(const file of users){const target=path.join(light,file),user=read(target,{});evidence+=(user.evidence||[]).length;restrictions+=(user.restrictions||[]).length;changes.set(target,{...user,evidence:[],restrictions:[],applied:{},baseline:{},observedSince:Date.parse(now)});}
const result={changed:APPLY,users:users.length,clearedCases:cases.length-kept.length,manualBansPreserved:kept.length,clearedEvidence:evidence,clearedAutomaticRestrictions:restrictions};
if(APPLY){
 const backup=path.join(risk,'mark-backups',RESET_ID);fs.mkdirSync(backup,{recursive:true,mode:0o700});
 for(const [file]of changes){if(fs.existsSync(file)){const dest=path.join(backup,path.relative(risk,file));fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});fs.copyFileSync(file,dest,fs.constants.COPYFILE_EXCL);fs.chmodSync(dest,0o600);}}
 // No user requests can run while these files are replaced.
 const ordered=[...changes].filter(([file])=>file!==marker).concat([[marker,changes.get(marker)]]);
 const existed=new Set([...changes.keys()].filter(file=>fs.existsSync(path.join(backup,path.relative(risk,file)))));
 try{
  for(const [file,value]of ordered){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.reset-'+RESET_ID;fs.writeFileSync(tmp,JSON.stringify(value),{mode:0o600,flag:'wx'});fs.renameSync(tmp,file);}
 }catch(error){
  for(const [file]of changes){if(existed.has(file))fs.copyFileSync(path.join(backup,path.relative(risk,file)),file);else if(fs.existsSync(file))fs.unlinkSync(file);}
  throw error;
 }
 result.backupCreated=true;
}
console.log(JSON.stringify(result));
'''

def main():
    if len(sys.argv) not in (2,3) or not re.fullmatch(r'[a-z0-9][a-z0-9_.-]{0,100}',sys.argv[1]) or sys.argv[2:] not in ([],['--apply']):
        raise SystemExit(__doc__)
    root=Path(__file__).resolve().parent.parent
    spec=importlib.util.spec_from_file_location('deploy',root/'scripts/deploy-paramiko.py')
    deploy=importlib.util.module_from_spec(spec);spec.loader.exec_module(deploy)
    client=deploy.connect(); stopped=False
    apply='--apply' in sys.argv
    script=RESET_SCRIPT.replace('RESET_ID',json.dumps(sys.argv[1])).replace('APPLY','true' if apply else 'false')
    try:
        info=json.loads(deploy.run_remote(client,'docker inspect love-for-nai',quiet=True))[0]
        data_root=deploy.run_remote(client,"docker exec love-for-nai node -e 'console.log(require(\"path\").resolve(process.env.LFN_DATA_DIR||\"data\"))'",quiet=True)
        mounts=[m['Destination'].rstrip('/') for m in info.get('Mounts',[]) if m.get('RW')]
        if not any(data_root==m or data_root.startswith(m+'/') for m in mounts):
            raise RuntimeError('Risk data is not inside a persistent writable mount')
        if apply:
            deploy.run_remote(client,'docker stop --time 30 love-for-nai',quiet=True);stopped=True
            command='docker run --rm --network none --volumes-from love-for-nai -e '+shlex.quote('LFN_DATA_DIR='+data_root)+' --entrypoint node '+shlex.quote(info['Config']['Image'])+' -e '+shlex.quote(script)
        else:
            command='docker exec love-for-nai node -e '+shlex.quote(script)
        print(deploy.run_remote(client,command,quiet=True),flush=True)
    finally:
        if stopped:deploy.run_remote(client,'docker start love-for-nai',quiet=True)
        client.close()

if __name__=='__main__':main()
