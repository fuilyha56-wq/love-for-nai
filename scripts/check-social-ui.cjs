/* Local-only regression. All account writes and generated images are mocked. */
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
try { process.loadEnvFile('.env.local'); process.env.LFN_UI_TEST_SESSION_SECRET ||= process.env.LFN_SESSION_SECRET; } catch {}
process.env.LFN_UI_BASE_URL ||= 'http://127.0.0.1:3100';
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve('.tmp/browser-check/node_modules/playwright-core');
const {setup, chromium, baseURL} = require('./check-mobile-ui.cjs');
const {installAdminFixtures} = require('./ui-admin-fixtures.cjs');
const output = path.resolve('.tmp/social-ui'); fs.mkdirSync(output, {recursive:true});
const results = [], errors = [];
const image = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="400"><rect width="500" height="400" fill="#e4e5de"/></svg>');
const comments = [{id:'social-comment', authorId:3, authorName:'示例用户', content:'评论与风控标题保持平整，不受玻璃效果影响。', createdAt:'2026-10-26T00:00:00Z', parentId:null, likes:1, dislikes:0}, {id:'social-reply',authorId:7,authorName:'测试画师',content:'回复内容同样保持正常排版。',createdAt:'2026-10-26T01:00:00Z',parentId:'social-comment',likes:0,dislikes:0}];
async function fixture(browser, width, glass=false) {
  const t = await setup(browser, {theme:'paper', workspaceLayout:'lfn', glass}, {width,height:884});
  t.page.on('pageerror', error => errors.push(error.message));
  t.page.on('console', message => { if (message.type()==='error' && /hydration|hydrated|didn't match/i.test(message.text())) errors.push(message.text()); });
  await t.context.route('**/api/gallery/social-work**', route => {
    if (route.request().url().includes('/comments')) return route.fulfill({json:{items:comments,viewerId:7777777,canModerate:true,preferences:{hiddenIds:[],blockedAuthorIds:[]}}});
    if (route.request().url().endsWith('/image')) return route.fulfill({contentType:'image/svg+xml',body:image});
    return route.fulfill({json:{item:{id:'social-work', title:'界面回归作品',authorName:'测试画师',ownerName:'上传者',rating:'general',source:'lfn',tags:[],prompt:'landscape',negativePrompt:'',parameters:{prompt:'landscape'},imageUrl:'/api/gallery/social-work/image',likes:1}}});
  });
  return t;
}
async function run(name, fn) {
  if (process.env.LFN_SOCIAL_FILTER && !name.includes(process.env.LFN_SOCIAL_FILTER)) return;
  console.log('RUN '+name);
  try { await fn(); results.push({name,passed:true}); console.log('PASS '+name); }
  catch (error) { results.push({name,passed:false,error:error.stack}); console.error('FAIL '+name+' '+error.message); }
}
async function flat(locator) {
  assert(await locator.count());
  for (const el of await locator.all()) {
    const style = await el.evaluate(el => { const s=getComputedStyle(el); return {shadow:s.boxShadow,blur:s.backdropFilter,background:s.backgroundColor,font:s.fontFamily}; });
    assert.equal(style.shadow,'none',JSON.stringify(style));
    assert(['none',undefined].includes(style.blur),JSON.stringify(style));
    assert.equal(style.background,'rgba(0, 0, 0, 0)',JSON.stringify(style));
    assert(style.font.includes('Noto Sans SC'),JSON.stringify(style));
  }
}
async function fit(page) { assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page overflow'); }
(async()=>{
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    for (const width of [390,762,1149,1366]) for (const glass of [false,true]) await run(`flat-headings-ip-layout-${width}-${glass}`,async()=>{
      const {context,page} = await fixture(browser,width,glass);
      try {
        await page.goto(baseURL+'/gallery/social-work'); await page.locator('#discussion-comment-social-comment').waitFor();
        await flat(page.locator('.discussion-heading, .discussion-comment-content > header'));
        await page.locator('#comments').scrollIntoViewIfNeeded(); await fit(page);
        await page.screenshot({path:path.join(output,`comments-${width}-${glass}.png`)});
        await installAdminFixtures(context,{gallery:[],documents:[],image});
        await context.route('**/api/admin/risk/ip?*',route=>route.fulfill({json:{items:[
          {evidenceId:'ip-a',ipHmac:'a',userId:3,username:'示例用户',family:'ipv4',requestCount:25130,lastSeenAt:'2026-10-26T04:14:00Z'},
          {evidenceId:'ip-b',ipHmac:'b',userId:3,username:'示例用户',family:'ipv6',requestCount:99,lastSeenAt:'2026-10-26T04:13:00Z'},
          {evidenceId:'ip-c',ipHmac:'c',userId:7,username:'长用户名排版测试测试测试测试测试测试',family:'ipv4',requestCount:3850,lastSeenAt:'2026-10-26T04:11:00Z'},
        ]}}));
        await page.goto(baseURL+'/admin?tab=risk'); await page.getByRole('heading',{name:'风控管理',exact:true}).waitFor();
        await flat(page.locator('.risk-heading'));
        await page.getByRole('tab',{name:'IP 证据',exact:true}).click();
        const groups=page.locator('.risk-ip-account-group'); await groups.first().waitFor(); assert.equal(await groups.count(),2);
        const summary=groups.first().locator('summary'); const text=await summary.innerText(); assert(text.includes('26') && text.includes('2') && text.includes('示例用户'),text);
        assert.equal(await summary.evaluate(el=>getComputedStyle(el).display),'grid');
        assert((await summary.evaluate(el=>getComputedStyle(el).fontFamily)).includes('Noto Sans SC'));
        await summary.focus(); await summary.press('Enter'); assert.equal(await groups.first().getAttribute('open'),''); assert.equal(await groups.first().locator('tbody > tr').count(),2);
        await summary.press('Enter'); assert.equal(await groups.first().getAttribute('open'),null);
        await fit(page); if(width<1024) await summary.evaluate(el=>el.scrollIntoView({block:'center'})); await page.screenshot({path:path.join(output,`ip-${width}-${glass}.png`)});
      } finally {await context.close();}
    });
    for (const width of [390,1366]) await run('announcement-flat-glass-'+width,async()=>{
      const {context,page}=await fixture(browser,width,true);
      try {
        await context.route('**/api/announcements',route=>route.fulfill({json:{items:[{id:'social-notice',title:'公告评论回归',content:'公告内容',author:'管理员',createdAt:'2026-10-26T00:00:00Z'}]}}));
        await context.route('**/api/announcements/*/comments',route=>route.fulfill({json:{items:comments,viewerId:7777777,preferences:{hiddenIds:[],blockedAuthorIds:[]}}}));
        await page.goto(baseURL+'/announcements?announcement=social-notice'); await page.locator('#discussion-comment-social-comment').waitFor();
        await flat(page.locator('.discussion-heading, .discussion-comment-content > header')); await fit(page);
      } finally {await context.close();}
    });
    for(const aWidth of [390,1366]) await run('cross-device-read-'+aWidth,async()=>{
      let messages=Array.from({length:3},(_,i)=>({id:'notice-'+i,userId:7777777,type:'system',title:'设备同步消息 '+i,body:'跨设备已读验收',href:'/notifications?opened='+i,createdAt:'2026-10-26T00:00:00Z',readAt:null}));
      let fail=false, delayNext=false, releaseOld, delayedStarted;
      const devices=[];
      async function device(width,bell=false) {
        const t=await fixture(browser,width); devices.push(t);
        if(bell) await t.page.clock.install();
        await t.context.route('**/api/notifications**',async route=>{
          const req=route.request();
          if(req.method()==='PATCH') {
            if(fail) return route.fulfill({status:500,json:{message:'模拟回执失败，请重试。'}});
            const body=req.postDataJSON(); messages=messages.map(item=>body.all||item.id===body.id?{...item,readAt:item.readAt||new Date().toISOString()}:item);
            return route.fulfill({json:{unreadCount:messages.filter(x=>!x.readAt).length}});
          }
          const data={items:structuredClone(messages),unreadCount:messages.filter(x=>!x.readAt).length};
          if(bell&&delayNext) {delayNext=false; delayedStarted(); await new Promise(resolve=>{releaseOld=resolve;});}
          await route.fulfill({json:data}).catch(()=>{});
        });
        await t.page.goto(baseURL+(bell?'/image':'/notifications')); return t;
      }
      try {
        const a=await device(aWidth), b=await device(aWidth===390?1366:390), c=await device(1366,true);
        const count=async(t,n,bell=false)=>bell?t.page.getByRole('link',{name:n?`消息，有 ${n} 条未读`:'消息',exact:true}).waitFor():n?t.page.getByText(`${n} 条未读`,{exact:true}).waitFor():assert(await t.page.getByRole('button',{name:'全部已读',exact:true}).isDisabled());
        await count(a,3);await count(b,3);await count(c,3,true);
        fail=true;await a.page.getByRole('button').filter({hasText:'设备同步消息 0'}).click();await a.page.getByText('模拟回执失败，请重试。',{exact:false}).waitFor();assert(!a.page.url().includes('opened='));await count(a,3);fail=false;
        const started=new Promise(resolve=>{delayedStarted=resolve;});delayNext=true;await c.page.evaluate(()=>dispatchEvent(new Event('focus')));await started;
        await a.page.getByRole('button').filter({hasText:'设备同步消息 0'}).click();await a.page.waitForURL('**/notifications?opened=0');
        await c.page.evaluate(()=>dispatchEvent(new Event('focus')));await count(c,2,true);releaseOld();await c.page.waitForTimeout(150);await count(c,2,true);
        await b.page.evaluate(()=>dispatchEvent(new Event('pageshow')));await count(b,2);
        await a.page.getByRole('button').filter({hasText:'设备同步消息 1'}).click();await a.page.waitForURL('**/notifications?opened=1');
        await c.page.clock.fastForward(5100);await count(c,1,true);await b.page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await count(b,1);
        await a.page.getByRole('button',{name:'全部已读',exact:true}).click();await a.page.getByRole('button',{name:'全部已读',exact:true}).waitFor();
        await b.page.evaluate(()=>dispatchEvent(new Event('focus')));await b.page.waitForFunction(()=>[...document.querySelectorAll('button')].some(el=>el.textContent.includes('全部已读')&&el.disabled));await count(b,0);
        await c.page.evaluate(()=>dispatchEvent(new Event('focus')));await count(c,0,true);
        const fresh=await device(390);await fresh.page.getByText('设备同步消息 0',{exact:true}).waitFor();await count(fresh,0);
        messages.unshift({...messages[0],id:'new',title:'真正的新消息',readAt:null});await c.page.evaluate(()=>dispatchEvent(new Event('focus')));await count(c,1,true);
      } finally {if(releaseOld) releaseOld();await Promise.all(devices.map(t=>t.context.close()));}
    });
  } finally {
    await browser.close();fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({results,errors},null,2));
  }
  if(results.some(x=>!x.passed)||errors.length)process.exitCode=1;
})();
