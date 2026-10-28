/* Real read-receipt API regression, only in the disposable, unmounted QA container. */
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const container = 'lfn-social-final-verify';
const base = process.env.LFN_UI_BASE_URL;
assert(base && ['localhost','127.0.0.1'].includes(new URL(base).hostname));
assert(process.env.LFN_UI_TEST_SESSION_SECRET);
const info = JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
assert.equal(info.Config.Image,'love-for-nai:social-20261026-r1');
assert.equal(info.Mounts.length,0,'Never seed data into a mounted or production container');
function cookie(userId) {
  const key=crypto.createHash('sha256').update(process.env.LFN_UI_TEST_SESSION_SECRET).digest(), iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  const data={userId,username:'read-receipt-qa',displayName:'隔离验收',upstreamCookie:'',authenticatedAt:Date.now(),expiresAt:Date.now()+3600000,epoch:1,userEpoch:1};
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(data)),cipher.final()]);
  return 'lfn_session='+[iv,cipher.getAuthTag(),encrypted].map(x=>x.toString('base64url')).join('.');
}
const items=Array.from({length:3},(_,i)=>({id:'read-qa-'+i,userId:7777777,type:'system',title:'隔离验收 '+i,body:'',href:'/notifications',createdAt:new Date().toISOString(),readAt:null}));
execFileSync('docker',['exec','-i',container,'node','-e',`const fs=require('fs');const input=fs.readFileSync(0,'utf8');fs.mkdirSync('/app/data/notifications',{recursive:true});fs.writeFileSync('/app/data/notifications/7777777.json',input);`],{input:JSON.stringify({items})});
(async()=>{
  const a=cookie(7777777),b=cookie(7777777),other=cookie(8888888);
  const request=async(token,body)=>{
    const response=await fetch(base+'/api/notifications',{method:body?'PATCH':'GET',headers:{cookie:token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    if(response.ok) assert(response.headers.get('cache-control').includes('no-store'));
    return {response,data:await response.json()};
  };
  assert.equal((await request(a)).data.unreadCount,3);
  assert.equal((await request(a,{id:''})).response.status,400);
  assert.equal((await request(b)).data.unreadCount,3);
  assert.equal((await request(a,{id:items[0].id})).data.unreadCount,2);
  const fromB=await request(b);assert(fromB.data.items.find(x=>x.id===items[0].id).readAt);assert.equal(fromB.data.unreadCount,2);
  assert.equal((await request(other)).data.unreadCount,0);
  assert.equal((await request(b,{all:true})).data.unreadCount,0);
  assert.equal((await request(a)).data.unreadCount,0);
  assert.equal((await request(cookie(7777777))).data.unreadCount,0);
  const stored=JSON.parse(execFileSync('docker',['exec',container,'node','-e',`process.stdout.write(require('fs').readFileSync('/app/data/notifications/7777777.json','utf8'))`],{encoding:'utf8'}));
  assert(stored.items.every(x=>x.readAt));
  const result={passed:true,checks:['single-read-across-sessions','all-read-across-sessions','fresh-session-read','account-isolation','empty-id-rejected','no-shared-cache','receipts-persisted'],productionDataTouched:false};
  fs.writeFileSync('.tmp/social-ui/api-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(error=>{console.error(error);process.exitCode=1;});
