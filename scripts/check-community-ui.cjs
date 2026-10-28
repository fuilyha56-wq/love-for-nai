/* Local-only browser acceptance. All business mutations are intercepted. */
/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
try { process.loadEnvFile('.env.local'); process.env.LFN_UI_TEST_SESSION_SECRET ||= process.env.LFN_SESSION_SECRET; } catch {}
process.env.LFN_UI_BASE_URL ||= 'http://127.0.0.1:3100';process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve('.tmp/browser-check/node_modules/playwright-core');
const {setup,chromium,baseURL}=require('./check-mobile-ui.cjs');
const output=path.resolve('.tmp/requested-ui');fs.mkdirSync(output,{recursive:true});const results=[];const errors=[];
const img=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800"><rect width="640" height="800" fill="#d5e9e5"/><circle cx="320" cy="300" r="140" fill="#a63a52"/><text x="180" y="620" font-size="38">LFN UI Preview</text></svg>');
const makeItem=i=>({id:'request-fixture-'+i,title:'山间旅行 '+i,ownerName:'布局测试',authorName:'测试画师',ownerId:7777777,rating:'general',source:'lfn',tags:['sky','landscape'],prompt:'blue sky, green mountains, soft lighting',negativePrompt:'low quality',parameters:{model:'nai-v5-full',width:832,height:1216,steps:28},imageUrl:'/api/history/request-fixture-'+i+'/image',likes:2,downloads:0,uses:0});
async function fixture(browser,width=390,prefs={}) {
 const t=await setup(browser,{theme:'paper',workspaceLayout:'lfn',...prefs},{width,height:884});let liked=false;let prefsState={hiddenIds:[],blockedAuthorIds:[]};let comments=[{id:'comment-1',authorId:3,authorName:'示例用户',content:'第一条评论，支持回复、点赞和个人屏蔽。',createdAt:new Date().toISOString(),parentId:null,pinned:false,likes:0,dislikes:0,myVote:null},{id:'comment-2',authorId:7777777,authorName:'布局测试',content:'自己的评论',createdAt:new Date().toISOString(),parentId:null,pinned:false,likes:0,dislikes:0,myVote:null}];
 await t.context.route('**/api/users/*/avatar*',r=>r.fulfill({contentType:'image/svg+xml',body:img}));
 await t.context.route('**/api/history/*/image',r=>r.fulfill({contentType:'image/svg+xml',body:img}));
 await t.context.route('**/api/aff/referral',r=>r.fulfill({json:{enabled:true,invitedCount:5,registrationReward:2,link:baseURL+'/register?ref=preview'}}));
 await t.context.route('**/api/comments/preferences',r=>{const b=r.request().postDataJSON();if(b.commentId)prefsState.hiddenIds=b.hidden?[...prefsState.hiddenIds,b.commentId]:prefsState.hiddenIds.filter(id=>id!==b.commentId);if(b.authorId)prefsState.blockedAuthorIds=b.hidden?[...prefsState.blockedAuthorIds,b.authorId]:prefsState.blockedAuthorIds.filter(id=>id!==b.authorId);return r.fulfill({json:prefsState});});
 await t.context.route('**/api/me/avatar',r=>r.fulfill({json:{charged:5,balance:95,avatar:{hash:'fixture'}}}));
 await t.context.route('**/api/gallery**',r=>{
  const req=r.request(),u=new URL(req.url());const p=u.pathname;
  if(p.endsWith('/comments')) {
   if(req.method()==='POST'){const b=req.postDataJSON();const item={...comments[1],id:'new-comment',content:b.content,parentId:b.parentId};comments.push(item);return r.fulfill({json:{item}});}
   if(req.method()==='PATCH'){const b=req.postDataJSON();const item=comments.find(x=>x.id===b.commentId);item.myVote=b.vote;item.likes=b.vote==='up'?1:0;item.dislikes=b.vote==='down'?1:0;return r.fulfill({json:{item}});}
   return r.fulfill({json:{items:comments,viewerId:7777777,canModerate:true,preferences:prefsState}});
  }
  if(/\/comments\/[^/]+$/.test(p)){const id=p.split('/').at(-1);comments=comments.filter(x=>x.id!==id&&x.parentId!==id);return r.fulfill({json:{deletedIds:[id]}});}
  if(p.endsWith('/like')){liked=!liked;return r.fulfill({json:{liked,likes:liked?3:2}});}
  if(p==='/api/gallery') {
   if(req.method()==='POST')return r.fulfill({json:{item:makeItem(1),message:'投稿成功'}});
   const page=Math.max(1,Number(u.searchParams.get('page'))||1);return r.fulfill({json:{items:Array.from({length:100},(_,i)=>makeItem((page-1)*100+i+1)),total:205,page,pageCount:3,tags:['sky','landscape']}});
  }
  if(p==='/api/gallery/mine')return r.fulfill({json:{items:[]}});
  return r.fulfill({json:{item:{...makeItem(Number(p.split('-').at(-1))||1),liked,requireLikeForParameters:true,parametersLocked:!liked,prompt:liked?'blue sky, green mountains, soft lighting':'',negativePrompt:liked?'low quality':'',parameters:liked?makeItem(1).parameters:{}}}});
 });
 t.page.on('pageerror',e=>errors.push(e.message));t.page.on('console',m=>{if(m.type()==='error'&&/hydration|hydrated|didn't match/i.test(m.text()))errors.push(m.text());});return t;
}
async function run(name,fn){if(process.env.SCENARIO&&!name.includes(process.env.SCENARIO))return;try{await fn();results.push({name,passed:true});console.log('PASS '+name);}catch(e){results.push({name,passed:false,error:e.stack});console.log('FAIL '+name+': '+e.message);}}
async function shot(page,name){await page.screenshot({path:path.join(output,name+'.png'),animations:'disabled'});}
async function fit(page){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');}
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 for(const width of [390,762,1023,1024,1366])await run('viewport-font-'+width,async()=>{const {context,page}=await fixture(browser,width);try{
  await page.goto(baseURL+'/image');await page.locator('[data-studio-layout]').waitFor();await page.waitForTimeout(750);
  assert.equal(await page.locator('[data-viewport-surface]:visible').getAttribute('data-viewport-surface'),width<=1023?'mobile':'desktop');
  assert.equal(await page.locator('.mobile-studio-launcher:visible').count(),width<=1023?1:0);await fit(page);
  const fonts=await page.evaluate(()=>[...new Set([...document.querySelectorAll('button,input,textarea,h1,h2,p')].filter(e=>e.getClientRects().length).map(e=>getComputedStyle(e).fontFamily))]);assert(fonts.every(f=>/Noto Sans SC/.test(f)),JSON.stringify(fonts));assert(await page.evaluate(async()=>{await document.fonts.ready;return document.fonts.check('14px "Noto Sans SC"','中文字体');}),'Noto Sans SC loads');
  if(width===390||width===1366)await shot(page,'studio-'+width);
 }finally{await context.close();}});
 for(const width of [390,1366])await run('prompt-versions-'+width,async()=>{const {context,page}=await fixture(browser,width);try{
  await page.goto(baseURL+'/image');await page.locator('[data-studio-layout]').waitFor();
  if(width<1024)await page.locator('.mobile-studio-prompt-toggle').click();
  await page.waitForTimeout(700);const input=page.locator('textarea:visible').first();await input.fill('version one, blue sky');await page.waitForTimeout(80);await input.fill('version two, green mountains');await page.waitForTimeout(80);await input.fill('version three, sunset');
  await page.getByRole('button',{name:'提示词版本',exact:true}).first().click();const dialog=page.getByRole('dialog',{name:'提示词版本',exact:true});await dialog.waitFor();
  assert(await dialog.getByText('version one, blue sky',{exact:true}).count()>0,await dialog.innerText());
  await dialog.locator('label').filter({hasText:'version one, blue sky'}).locator('input').check();
  assert.equal(await dialog.locator('.prompt-versions-details textarea').count(),2);await fit(page);await shot(page,'prompt-versions-'+width);
  await dialog.locator('article').filter({has:page.locator('textarea',{})}).last().getByRole('button',{name:'恢复此版本'}).click();
  assert.equal(await input.inputValue(),'version one, blue sky');
 }finally{await context.close();}});

 for(const width of [390,1366])await run('prompt-history-night-theme-'+width,async()=>{const {context,page}=await fixture(browser,width,{theme:'night'});try{
  await page.goto(baseURL+'/image');await page.locator('[data-studio-layout]').waitFor();await page.waitForTimeout(500);if(width<1024)await page.locator('.mobile-studio-prompt-toggle').click();await page.getByRole('button',{name:'提示词版本',exact:true}).first().click();const dialog=page.getByRole('dialog',{name:'提示词版本',exact:true});await dialog.waitFor();const colors=await dialog.evaluate(el=>({background:getComputedStyle(el).backgroundColor,panel:getComputedStyle(document.documentElement).getPropertyValue('--panel').trim(),text:getComputedStyle(el).color}));assert.notEqual(colors.background,'rgb(255, 254, 250)');assert.notEqual(colors.background,colors.text);await fit(page);await shot(page,'prompt-versions-night-'+width);
 }finally{await context.close();}});
 await run('mobile-profile-avatar',async()=>{const {context,page}=await fixture(browser);try{await page.goto(baseURL+'/profile');await page.getByRole('heading',{name:'邀请奖励'}).waitFor();
  assert.equal(await page.locator('.profile-sidebar-nav').count(),0);for(const id of ['#profile-redeem','#profile-personal','#profile-security'])if(await page.locator(id).count())assert(await page.locator(id).isVisible());
  assert((await page.getByLabel('邀请注册链接').inputValue()).includes('preview'));await fit(page);await shot(page,'profile-mobile');
  const png=await require('sharp')({create:{width:700,height:500,channels:3,background:'#a63a52'}}).png().toBuffer();
  await page.locator('.avatar-settings input[type=file]').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:png});const dialog=page.getByRole('dialog',{name:'修改头像',exact:true});await dialog.waitFor();await dialog.getByRole('button',{name:'支付 5 AFF 并保存头像'}).waitFor();assert(await dialog.locator('canvas').isVisible());await shot(page,'avatar-mobile');await dialog.getByRole('button',{name:'支付 5 AFF 并保存头像'}).click();await page.getByText('头像已更新。',{exact:true}).waitFor();
 }finally{await context.close();}});
 for(const width of [390,1366])await run('gallery-pagination-return-comments-'+width,async()=>{const {context,page}=await fixture(browser,width);try{
  await page.goto(baseURL+'/gallery?page=2&sort=likes');await page.getByRole('link',{name:'查看作品详情：山间旅行 101',exact:true}).waitFor();
  assert.equal(await page.locator('a[aria-label^="查看作品详情："]').count(),100);
  const card=page.getByRole('link',{name:'查看作品详情：山间旅行 121',exact:true});await card.scrollIntoViewIfNeeded();const before=await page.evaluate(()=>scrollY);await card.click();
  await page.getByRole('heading',{name:'山间旅行 121',exact:true}).waitFor();await page.getByText('作者设置了点赞后查看提示词与生成参数。',{exact:true}).first().waitFor();await fit(page);await shot(page,'gallery-detail-'+width);
  const like=width<1024?page.getByRole('button',{name:/点赞/}).first():page.locator('aside button').first();await like.click();await page.getByText('blue sky, green mountains, soft lighting',{exact:true}).first().waitFor();
  const cancelLike=width<1024?page.getByRole('button',{name:'已点赞',exact:true}):page.locator('aside button').first();await cancelLike.click();await page.getByText('作者设置了点赞后查看提示词与生成参数。',{exact:true}).waitFor();assert.equal(await page.getByText('blue sky, green mountains, soft lighting',{exact:true}).count(),0);const compose=page.getByRole('textbox',{name:'发表评论'});await compose.fill('UI 评论发布验证');await page.getByRole('button',{name:'发布',exact:true}).click();await page.getByText('UI 评论发布验证',{exact:true}).waitFor();
  const first=page.locator('#discussion-comment-comment-1');await first.getByRole('button',{name:'点赞评论',exact:true}).click();await first.locator('button[aria-label="点赞评论"][aria-pressed="true"]').waitFor();assert.equal(await first.getByRole('button',{name:'点赞评论',exact:true}).getAttribute('aria-pressed'),'true');
  await first.locator('summary').click();await first.getByRole('menuitem',{name:'屏蔽此用户',exact:true}).click();await first.getByText('已屏蔽此用户的评论。',{exact:false}).waitFor();await first.getByRole('button',{name:'恢复显示',exact:true}).click();await first.locator('summary').click();await first.getByRole('menuitem',{name:'删除评论',exact:true}).click();await first.getByRole('button',{name:'确认删除',exact:true}).click();await first.waitFor({state:'detached'});
  await shot(page,'comments-'+width);await (width<1024?page.getByRole('link',{name:'返回图片广场',exact:true}):page.getByRole('link',{name:'返回图片广场',exact:true})).click();
  await page.getByRole('link',{name:'查看作品详情：山间旅行 101',exact:true}).waitFor();await page.waitForTimeout(500);assert(new URL(page.url()).searchParams.get('page')==='2');const after=await page.evaluate(()=>scrollY);assert(Math.abs(after-before)<20,`scroll restored ${before} => ${after}`);await fit(page);
 }finally{await context.close();}});

 for(const width of [390,1366])await run('ip-grouping-'+width,async()=>{const {context,page}=await fixture(browser,width);try{
  const {installAdminFixtures}=require('./ui-admin-fixtures.cjs');await installAdminFixtures(context,{gallery:[],documents:[],image:img});
  await context.route('**/api/admin/risk/ip?*',r=>r.fulfill({json:{items:[{evidenceId:'evidence-first',ipHmac:'same-ip',userId:3,username:'示例用户',family:'ipv4',requestCount:2,lastSeenAt:'2026-10-25T12:00:00Z'},{evidenceId:'evidence-second',ipHmac:'other-ip',userId:3,username:'示例用户',family:'ipv6',requestCount:3,lastSeenAt:'2026-10-25T13:00:00Z'}]}}));
  await page.goto(baseURL+'/admin?tab=risk');await page.getByRole('tab',{name:'IP 证据',exact:true}).click();const group=page.locator('.risk-ip-account-group');await group.waitFor();assert.equal(await group.count(),1);assert((await group.locator('summary').innerText()).includes('2 个 IP'));await group.locator('summary').click();assert.equal(await group.locator('tbody > tr').count(),2);await fit(page);await shot(page,'ip-grouping-'+width);
 }finally{await context.close();}});

 for(const width of [390,1366])await run('announcements-comments-'+width,async()=>{const {context,page}=await fixture(browser,width);try{
  await context.route('**/api/announcements',r=>r.fulfill({json:{items:[{id:'announcement-fixture',title:'社区评论功能更新',content:'支持点赞、回复与个人屏蔽。',createdAt:'2026-10-25T00:00:00Z',author:'管理团队',pinned:true,level:'info'}]}}));
  await context.route('**/api/announcements/*/comments',r=>r.fulfill({json:{items:[{id:'notice-comment',authorId:3,authorName:'示例用户',content:'公告评论也支持完整互动',createdAt:new Date().toISOString(),parentId:null,pinned:false,likes:1,dislikes:0,myVote:null}],viewerId:7777777,canModerate:true,preferences:{hiddenIds:[],blockedAuthorIds:[]}}}));
  await page.goto(baseURL+'/announcements?announcement=announcement-fixture&comment=notice-comment');await page.locator('#discussion-comment-notice-comment.is-highlighted').waitFor();assert(await page.getByRole('button',{name:'点赞评论',exact:true}).isVisible());assert(await page.getByRole('button',{name:'点踩评论',exact:true}).isVisible());assert(await page.getByRole('textbox',{name:'发表评论',exact:true}).isVisible());await fit(page);await shot(page,'announcements-'+width);
 }finally{await context.close();}});
 await run('mobile-history-gallery-submit',async()=>{const {context,page}=await fixture(browser);try{
  await page.goto(baseURL+'/image');await page.getByRole('button',{name:'历史',exact:true}).click();await page.locator('.replica-history-card').first().waitFor();
  await page.locator('.replica-history-card').first().getByRole('button',{name:/更多|操作/}).click();await page.getByRole('menuitem',{name:'投稿图片广场',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'提交作品',exact:true});await dialog.waitFor();await fit(page);assert(await dialog.getByText('点赞后查看提示词与生成参数',{exact:true}).isVisible());await shot(page,'gallery-submit-mobile');
 }finally{await context.close();}});
}finally{await browser.close();fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({results,errors},null,2));console.log(JSON.stringify({passed:results.filter(x=>x.passed).length,total:results.length,errors}));if(results.some(x=>!x.passed)||errors.length)process.exitCode=1;}})();
