/* Local browser regression checks; business writes stay mocked. */
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
try { process.loadEnvFile('.env.local'); process.env.LFN_UI_TEST_SESSION_SECRET ||= process.env.LFN_SESSION_SECRET; } catch {}
process.env.LFN_UI_BASE_URL ||= 'http://127.0.0.1:3100';
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve('.tmp/browser-check/node_modules/playwright-core');
const {setup: baseSetup, chromium, baseURL} = require('./check-mobile-ui.cjs');
const results=[];const errors=[];
async function setup(...args){const result=await baseSetup(...args);result.page.on('pageerror',e=>errors.push(e.message));result.page.on('console',m=>{if(m.type()==='error'&&/hydration|hydrated|didn't match/i.test(m.text()))errors.push(m.text());});return result;}

async function run(name,fn){if(process.env.LFN_NAV_FILTER&&!name.includes(process.env.LFN_NAV_FILTER))return;console.log("RUN",name);try{await fn();results.push({name,passed:true});console.log('PASS',name);}catch(e){results.push({name,passed:false,error:e.stack});console.error('FAIL',name,e.message);}}
async function studio(page,width){await page.goto(baseURL+'/image');await page.locator('[data-studio-layout]').waitFor();if(width<1024)await page.locator('.mobile-studio-workbar').waitFor();}
async function history(page,width){
 await page.locator("[data-studio-layout]").waitFor(); await page.waitForTimeout(500);
 if(width<1024){if(!await page.getByRole('dialog',{name:'历史记录',exact:true}).isVisible())await page.getByRole('button',{name:'打开历史记录',exact:true}).click();}
 else {const button=page.getByRole('button',{name:'展开历史记录',exact:true});if(await button.isVisible())await button.click();}
 await page.locator('.replica-history-card:visible').first().waitFor();
}
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
for(const width of [390,1023,1024,1366])await run('account-history-restores-'+width,async()=>{const {context,page}=await setup(browser,{theme:'paper',workspaceLayout:'nlw'},{width,height:884});try{
 await studio(page,width);await history(page,width);const prompt=await page.locator('.replica-history-card:visible').first().innerText();assert(prompt.length>0);
 // Real route unmount followed by a fresh visit, then full reload.
 await page.goto(baseURL+'/tags');await studio(page,width);await history(page,width);
 await page.reload();await history(page,width);assert.equal(await page.locator('.replica-history-card:visible').count(),1);
 if(width<1024){await page.goBack();await page.locator('.mobile-studio-page.is-generate').waitFor();assert.equal(new URL(page.url()).pathname,'/image');}
}finally{await context.close();}});
for(const width of [390,1023])await run('mobile-native-and-ui-back-'+width,async()=>{const {context,page}=await setup(browser,{theme:'paper',workspaceLayout:'nlw'},{width,height:884});try{
 await page.goto(baseURL+'/history');await page.locator('body').waitFor();await studio(page,width);
 for(const [name,label] of [['打开生成参数','生成参数'],['打开标签助手','标签助手'],['打开历史记录','历史记录']]){
  await page.getByRole('button',{name,exact:true}).click();await page.getByRole('dialog',{name:label,exact:true}).waitFor();await page.goBack();await page.getByRole('dialog',{name:label,exact:true}).waitFor({state:'hidden'});assert.equal(new URL(page.url()).pathname,'/image');assert(await page.locator('.mobile-studio-page.is-generate').isVisible());
  await page.getByRole('button',{name,exact:true}).click();await page.getByRole('dialog',{name:label,exact:true}).getByRole('button',{name:'关闭'+label,exact:true}).click();await page.getByRole('dialog',{name:label,exact:true}).waitFor({state:'hidden'});await page.waitForTimeout(150);assert.equal(new URL(page.url()).pathname,'/image');
 }
 await page.locator('.mobile-studio-bottom-nav').getByRole('button',{name:'历史',exact:true}).click();await page.locator('.mobile-studio-page.is-history').waitFor();await page.goBack();await page.locator('.mobile-studio-page.is-generate').waitFor();assert.equal(new URL(page.url()).pathname,'/image');
 await page.getByRole('link',{name:'查看消息',exact:true}).click();await page.getByRole('link',{name:'返回生成页面',exact:true}).waitFor();await page.goBack();await page.locator('.mobile-studio-page.is-generate').waitFor();assert.equal(new URL(page.url()).pathname,'/image');
}finally{await context.close();}});
for(const width of [390,1366])await run('local-history-parameters-and-route-return-'+width,async()=>{const {context,page}=await setup(browser,{theme:'paper',workspaceLayout:'nlw'},{width,height:884});try{
 await page.goto(baseURL+'/tags');await page.evaluate(async()=>{localStorage.setItem('lfn-image-history-mode-v1','local');await new Promise((resolve,reject)=>{const req=indexedDB.open('lfn-local-image-history-v1',1);req.onupgradeneeded=()=>req.result.createObjectStore('images',{keyPath:'id'});req.onsuccess=()=>{const db=req.result;const tx=db.transaction('images','readwrite');tx.objectStore('images').put({id:'back-local-test',createdAt:Date.now(),image:new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800"/>'],{type:'image/svg+xml'}),prompt:'persistent local prompt',negative:'local negative',parameters:{width:640,height:800,steps:17,scale:0,sampler:'k_euler'}});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});});
 await studio(page,width);await history(page,width);assert.equal(await page.locator('.replica-history-card:visible').count(),1);await page.goto(baseURL+'/gallery');await studio(page,width);await history(page,width);await page.reload();await history(page,width);assert.equal(await page.locator('.replica-history-card:visible').count(),1);
}finally{await context.close();}});
for(const width of [390,1366])await run('tag-detail-parent-'+width,async()=>{const {context,page}=await setup(browser,{},{width,height:884});try{
 await page.goto(baseURL+'/tags?key=missing-fixture&q=blue');const back=page.getByRole('link',{name:'返回检索结果',exact:true});await back.waitFor();assert((await back.getAttribute('href')).includes('q=blue'));await back.click();await page.waitForURL('**/tags?q=blue');assert.equal(new URL(page.url()).pathname,'/tags');
}finally{await context.close();}});
await run('mobile-docs-native-and-explicit-back',async()=>{const {context,page}=await setup(browser);try{
 await context.route('**/api/docs',r=>r.fulfill({json:{items:[{slug:'navigation-doc',title:'返回测试文档',summary:'测试目录和详情的返回',content:'文档内容',category:'帮助',status:'published',updatedAt:new Date().toISOString()}]}}));
 await page.goto(baseURL+'/tags');await page.goto(baseURL+'/docs');const doc=page.getByRole('button',{name:/返回测试文档/});await doc.click();await page.locator('[data-doc-detail="true"]').waitFor();await page.goBack();await page.locator('[data-doc-detail="false"]').waitFor();assert.equal(new URL(page.url()).pathname,'/docs');assert(!new URL(page.url()).searchParams.has('slug'));
 await doc.click();await page.getByRole('button',{name:'返回目录',exact:true}).click();await page.locator('[data-doc-detail="false"]').waitFor();assert.equal(new URL(page.url()).pathname,'/docs');
}finally{await context.close();}});
await run('unsaved-session-survives-client-route-switch',async()=>{const {context,page}=await setup(browser,{workspaceLayout:'nlw'});try{
 await page.goto(baseURL+'/tags');await page.evaluate(()=>localStorage.setItem('lfn-image-history-mode-v1','none'));await studio(page,390);await page.locator('.mobile-studio-footer button[data-studio-generate]').click();await page.locator('.mobile-studio-preview-section img').waitFor();
 await page.locator('.mobile-studio-bottom-nav a[href="/tags"]').click();await page.locator('.launcher-bottom-nav a[href="/image"]').click();await page.locator('.mobile-studio-workbar').waitFor();await history(page,390);assert.equal(await page.locator('.replica-history-card:visible').count(),1);assert.equal(await page.evaluate(()=>localStorage.getItem('lfn-image-history-mode-v1')),'none');
}finally{await context.close();}});
for(const width of [390,1366])await run('history-image-preview-native-back-'+width,async()=>{const {context,page}=await setup(browser,{workspaceLayout:'nlw'},{width,height:884});try{
 await studio(page,width);await history(page,width);await page.locator('.replica-history-card:visible .replica-history-preview').first().click();await page.getByRole('dialog',{name:'图片预览',exact:true}).waitFor();await page.goBack();await page.getByRole('dialog',{name:'图片预览',exact:true}).waitFor({state:'hidden'});assert.equal(new URL(page.url()).pathname,'/image');assert(await page.locator('.replica-history-card:visible').first().isVisible());
}finally{await context.close();}});
await run('desktop-history-delete-stays-deleted',async()=>{const {context,page}=await setup(browser,{workspaceLayout:'nlw'},{width:1366,height:884});let deleted=false;try{
 const item={id:'delete-navigation',createdAt:'2026-10-25T00:00:00Z',imageUrl:'/api/history/delete-navigation/image',parameters:{operation:'generate',prompt:'delete regression'}};
 await context.route(/\/api\/history(?:\?.*)?$/,r=>{if(r.request().method()==='DELETE'){deleted=true;return r.fulfill({json:{success:true}});}return r.fulfill({json:{items:deleted?[]:[item]}});});
 await studio(page,1366);await history(page,1366);await page.locator('.replica-history-card:visible').first().hover();await page.getByRole('button',{name:'删除第 1 张历史图像',exact:true}).click();await page.getByRole('dialog',{name:'确认操作',exact:true}).getByRole('button',{name:'确认',exact:true}).click();await page.locator('.replica-history-card').waitFor({state:'detached'});assert(deleted);await page.reload();await page.locator('.replica-history-empty:visible').waitFor();assert.equal(await page.locator('.replica-history-card').count(),0);
}finally{await context.close();}});
for(const width of [390,1366])await run('editor-returns-to-own-history-parent-'+width,async()=>{const {context,page}=await setup(browser,{},{width,height:884});try{
 const parent='/image/editor/history?draftId=return-fixture&branchId=branch';await page.goto(baseURL+'/image/editor?draftId=missing-fixture&returnTo='+encodeURIComponent(parent));await page.getByRole('button',{name:'返回重绘历史',exact:true}).first().click();await page.waitForURL('**/image/editor/history?draftId=return-fixture&branchId=branch');assert.equal(new URL(page.url()).pathname,'/image/editor/history');
}finally{await context.close();}});
for(const width of [390,1366])await run('stories-subpage-native-and-ui-back-'+width,async()=>{const {context,page}=await setup(browser,{},{width,height:884});try{
 await page.goto(baseURL+'/tags');await page.goto(baseURL+'/stories');const create=page.getByRole('button',{name:width<1024?'新故事':'新故事',exact:true});await create.click();const back=page.getByRole('button',{name:width<1024?'返回故事列表':'返回故事首页',exact:true});await back.waitFor();await page.goBack();await create.waitFor();assert.equal(new URL(page.url()).pathname,'/stories');await create.click();await back.click();await create.waitFor();assert.equal(new URL(page.url()).pathname,'/stories');
}finally{await context.close();}});
await run('signed-out-account-view-does-not-restore-unowned-cache',async()=>{const {context,page}=await setup(browser);try{
 await context.clearCookies();await page.goto(baseURL+'/tags');await page.evaluate(async()=>{localStorage.setItem('lfn-image-history-mode-v1','account');await new Promise(resolve=>{const req=indexedDB.open('lfn-local-image-history-v1',1);req.onupgradeneeded=()=>req.result.createObjectStore('images',{keyPath:'id'});req.onsuccess=()=>{const db=req.result;const tx=db.transaction('images','readwrite');tx.objectStore('images').put({id:'unowned-old-cache',remoteId:'old-account-history',createdAt:Date.now()-10000,image:new Blob(['old'],{type:'image/png'}),prompt:'other-account-private-prompt'});tx.oncomplete=()=>{db.close();resolve();};};});});
 await studio(page,390);await page.getByRole('button',{name:'打开历史记录',exact:true}).click();await page.getByRole('dialog',{name:'历史记录',exact:true}).locator('.replica-history-empty').waitFor();assert.equal(await page.locator('.replica-history-card:visible').count(),0);
}finally{await context.close();}});
}finally{await browser.close();fs.mkdirSync('.tmp/navigation-ui',{recursive:true});fs.writeFileSync('.tmp/navigation-ui/results.json',JSON.stringify({results,errors},null,2));}if(results.some(r=>!r.passed)||errors.length)process.exitCode=1;})();
