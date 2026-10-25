/* eslint-disable @typescript-eslint/no-require-imports -- Local viewport isolation acceptance. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
const { installContentFixtures } = require('./ui-content-fixtures.cjs');
const { installAdminFixtures } = require('./ui-admin-fixtures.cjs');
const output = '.tmp/launcher-ui/device-isolation';
fs.mkdirSync(output, { recursive:true });
const results=[];
async function check(name,action){if(process.env.LFN_DEVICE_UI_CHECK&&!new RegExp(process.env.LFN_DEVICE_UI_CHECK).test(name))return;try{await action();results.push({name,passed:true});console.log(`PASS ${name}`);}catch(error){results.push({name,passed:false,error:error.message});console.log(`FAIL ${name}: ${error.message}`);}}
(async()=>{
  const baseline='.tmp-build/nai-api-coverage-20261024/original/src/app';
  const manifest=JSON.parse(fs.readFileSync('.tmp/mobile-desktop-split-20261024/manifest.json','utf8'));
  await check('desktop-source-restored-to-local-original',async()=>{
    let checked=0;
    const concurrentUpdates=[];
    // These files also received independent auth/platform work after the rollback.
    // Keep those changes and report them separately instead of overwriting them.
    const functionalUpdates=new Set(['admin/admin.css','admin/page.tsx','admin/platform-config-panel.tsx','sign-in/page.tsx']);
    for(const entry of manifest.files.filter(file=>file.desktopBaseline)){
      if(entry.path==='layout.tsx'||entry.path==='globals.css')continue;
      let target=path.join('src/app',entry.path);
      if(entry.path==='not-found.tsx')target='src/app/desktop-not-found.tsx';
      else if(entry.path.endsWith('/page.tsx')&&fs.readFileSync(target,'utf8').includes('ViewportPage'))target=path.join(path.dirname(target),'desktop-page.tsx');
      let actual=fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n');
      const expected=fs.readFileSync(path.join(baseline,entry.path),'utf8').replace(/\r\n/g,'\n');
      if(entry.path.endsWith('.css'))actual=actual.replace(/^@media \(min-width: 840px\) \{\n/,'').replace(/\n\}\n$/,'');
      if(actual!==expected&&functionalUpdates.has(entry.path)){
        assert(!actual.includes('@/mobile/'),`Desktop functionality imports phone UI: ${entry.path}`);
        concurrentUpdates.push(entry.path);
      }else{
        assert(actual===expected,`Desktop baseline differs: ${entry.path}`);checked++;
      }
    }
    assert(checked>120);results.push({name:'desktop-baseline-files',checked,concurrentUpdates,passed:true});
    for(const file of ['appearance-store.ts','profile-navigation.ts']){
      const actual=fs.readFileSync(path.join('src/lib',file),'utf8').replace(/\r\n/g,'\n');
      const expected=fs.readFileSync(path.join('.tmp-build/nai-api-coverage-20261024/original/src/lib',file),'utf8').replace(/\r\n/g,'\n');
      assert(actual===expected,`Desktop preference/navigation changed: ${file}`);
    }
  });
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try{
    await check('desktop-mobile-preferences-and-mount-isolation',async()=>{
      const {context,page}=await setup(browser,{theme:'paper',workspaceLayout:'lfn'},{width:1254,height:884});
      page.setDefaultNavigationTimeout(90000);
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await installContentFixtures(context);
      try{
        await page.goto(`${baseURL}/settings#appearance`,{timeout:90000});
        await page.getByText('LFN 布局',{exact:true}).waitFor();
        await page.getByText('正在恢复本机外观偏好…',{exact:true}).waitFor({state:'hidden'});
        assert(await page.getByText('NovelAI Local',{exact:true}).isVisible());
        assert.equal(await page.getByText('Aaalice 工作台',{exact:true}).count(),0);
        assert.equal(await page.locator('.launcher-shell').count(),0,'Desktop does not mount the new phone shell');
        await page.screenshot({path:`${output}/desktop-settings-1254.png`,animations:'disabled'});
        await page.getByText('生图工作台布局',{exact:true}).scrollIntoViewIfNeeded();
        await page.screenshot({path:`${output}/desktop-layout-options-1254.png`,animations:'disabled'});
        await page.goto(`${baseURL}/image`);
        await page.waitForFunction(()=>document.querySelector('[data-studio-layout]')?.getAttribute('data-workspace-layout')==='lfn');
        await page.waitForFunction(()=>document.documentElement.dataset.viewportReady==='true');
        await page.waitForTimeout(300);
        const savedDesktop=await page.evaluate(()=>localStorage.getItem('lfn-ui-preferences-v1'));
        const savedDesktopLayout=await page.evaluate(()=>localStorage.getItem('lfn-custom-layout-v1'));
        await page.screenshot({path:`${output}/desktop-lfn-1254.png`,animations:'disabled'});
        await page.setViewportSize({width:808,height:884});
        await page.locator('.mobile-studio-launcher').waitFor({state:'visible'});
        assert.equal(await page.locator('.launcher-shell').count(),1);
        await page.getByRole('button',{name:'打开生成参数',exact:true}).click();
        const params=page.getByRole('dialog',{name:'生成参数',exact:true});
        const bounds=await params.boundingBox();assert(bounds&&bounds.x===0&&bounds.width===808&&bounds.height===884);
        await page.screenshot({path:`${output}/phone-parameters-808.png`,animations:'disabled'});
        await page.keyboard.press('Escape');
        await page.goto(`${baseURL}/settings#appearance`);
        await page.getByRole('button',{name:/夜间.*低亮度/s}).click();
        assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('lfn-mobile-ui-preferences-v1')).theme),'night');
        assert.equal(await page.evaluate(()=>localStorage.getItem('lfn-ui-preferences-v1')),savedDesktop,'Phone theme leaves desktop preference bytes unchanged');
        await page.goto(`${baseURL}/image/setting/layout`);
        await page.getByRole('button',{name:'保存并返回工作台',exact:true}).click();
        await page.waitForURL(`${baseURL}/image`);
        assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('lfn-mobile-ui-preferences-v1')).workspaceLayout),'custom');
        assert.equal(await page.evaluate(()=>localStorage.getItem('lfn-custom-layout-v1')),savedDesktopLayout,'Phone custom layout leaves desktop layout bytes unchanged');
        assert(await page.evaluate(()=>Boolean(localStorage.getItem('lfn-mobile-custom-layout-v1'))));
        await page.setViewportSize({width:1254,height:884});
        await page.waitForFunction(()=>document.querySelector('[data-studio-layout]')?.getAttribute('data-workspace-layout')==='lfn'&&document.documentElement.dataset.theme==='paper');
        assert.equal(await page.locator('.launcher-shell').count(),0);
        assert.equal(await page.evaluate(()=>localStorage.getItem('lfn-ui-preferences-v1')),savedDesktop);
        await page.screenshot({path:`${output}/desktop-return-1254.png`,animations:'disabled'});
        assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await check('phone-first-load-preserves-desktop-storage',async()=>{
      const {context,page}=await setup(browser,{}, {width:390,height:844});
      const desktopRaw=JSON.stringify({version:1,theme:'nai',workspaceLayout:'lfn',desktopOnlyMarker:'keep-exact'});
      const desktopLayout='desktop-layout-preservation-sentinel';
      await context.addInitScript(({desktopRaw,desktopLayout})=>{
        localStorage.setItem('lfn-ui-preferences-v1',desktopRaw);
        localStorage.setItem('lfn-custom-layout-v1',desktopLayout);
      },{desktopRaw,desktopLayout});
      try{
        await page.goto(`${baseURL}/image`,{timeout:90000});
        await page.locator('.mobile-studio-launcher').waitFor();
        await page.waitForTimeout(500);
        assert.equal(await page.evaluate(()=>localStorage.getItem('lfn-ui-preferences-v1')),desktopRaw);
        assert.equal(await page.evaluate(()=>localStorage.getItem('lfn-custom-layout-v1')),desktopLayout);
      }finally{await context.close();}
    });
    await check('phone-platform-settings-use-own-controls',async()=>{
      const {context,page}=await setup(browser,{}, {width:390,height:844});
      const nativeDialogs=[];
      page.on('dialog',dialog=>{nativeDialogs.push(dialog.type());void dialog.dismiss();});
      await installAdminFixtures(context,{gallery:[],documents:[],image:''});
      try{
        await page.goto(`${baseURL}/admin?tab=platform`,{timeout:90000});
        await page.getByRole('heading',{name:'基础站点',exact:true}).waitFor();
        await page.locator('.platform-category').filter({hasText:'注册与登录'}).click();
        const email=page.getByRole('switch',{name:'允许使用邮箱注册',exact:true});
        await email.click();
        assert.equal(await email.getAttribute('aria-checked'),'false');
        assert((await email.boundingBox()).height>=44);
        await page.getByRole('button',{name:'返回平台配置',exact:true}).click();
        const confirm=page.getByRole('dialog',{name:'确认操作',exact:true});
        await confirm.waitFor();
        for(const width of [320,390,808]){
          await page.setViewportSize({width,height:844});
          const bounds=await confirm.boundingBox();
          assert(bounds&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=845);
        }
        await page.screenshot({path:`${output}/phone-platform-confirm-808.png`,animations:'disabled'});
        await confirm.getByRole('button',{name:'取消',exact:true}).click();
        assert.equal(await email.getAttribute('aria-checked'),'false','Cancelling retains the phone form');
        await page.getByRole('button',{name:'返回平台配置',exact:true}).click();
        await confirm.getByRole('button',{name:'确认',exact:true}).click();
        await page.getByRole('heading',{name:'基础站点',exact:true}).waitFor();
        assert.equal(await page.locator('select,input[type=date],input[type=time],input[type=color],input[type=datetime-local]').count(),0);
        assert.deepEqual(nativeDialogs,[]);
      }finally{await context.close();}
    });
    await check('desktop-original-layout-variants',async()=>{
      for(const [theme,workspaceLayout] of [['paper','lfn'],['paper','nlw'],['nai','lfn'],['paper','custom']]){
        const {context,page}=await setup(browser,{theme,workspaceLayout},{width:1600,height:1000});
        try{
          await page.goto(`${baseURL}/image`,{timeout:90000});
          await page.waitForFunction(([theme,layout])=>document.documentElement.dataset.theme===theme&&document.querySelector('[data-studio-layout]')?.getAttribute('data-workspace-layout')===(theme==='nai'?null:layout),[theme,workspaceLayout]);
          await page.waitForFunction(()=>document.documentElement.dataset.viewportReady==='true');
          await page.waitForTimeout(300);
          assert.equal(await page.locator('.launcher-shell').count(),0);
          assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
          await page.screenshot({path:`${output}/desktop-${theme}-${workspaceLayout}-1600.png`,animations:'disabled'});
        }finally{await context.close();}
      }
    });
  }finally{await browser.close();}
  fs.writeFileSync(`${output}/results${process.env.LFN_DEVICE_UI_RUN?'-'+process.env.LFN_DEVICE_UI_RUN:''}.json`,JSON.stringify(results,null,2));
  process.exitCode=results.some(result=>!result.passed)?1:0;
})();
