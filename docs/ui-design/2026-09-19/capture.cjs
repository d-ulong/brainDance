const {chromium}=require('@playwright/test');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1800,height:1200},deviceScaleFactor:1});
    const errors=[],checks=[];
    page.on('pageerror',e=>errors.push(e.message));
    const index=pathToFileURL(path.join(__dirname,'index.html')).href;
    for(const theme of ['space','candy']){
      await page.goto(index+'?theme='+theme);
      await page.waitForTimeout(400);
      await page.screenshot({path:path.join(__dirname,theme+'-board.png'),fullPage:true});
      for(const width of [390,360]){
        await page.setViewportSize({width,height:width===390?844:800});
        await page.goto(pathToFileURL(path.join(__dirname,'screen.html')).href+'?theme='+theme);
        if(width===390)await page.screenshot({path:path.join(__dirname,theme+'-mobile.png'),fullPage:false});
        const result=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,taskTop:Math.round(document.querySelector('.next-task').getBoundingClientRect().top),buttonBottom:Math.round(document.querySelector('.primary').getBoundingClientRect().bottom),navigationCount:document.querySelectorAll('.nav-item').length}));
        if(result.scrollWidth>width||result.buttonBottom>720||result.navigationCount!==5)throw new Error('Draft layout check failed');
        checks.push({theme,...result});
      }
      await page.setViewportSize({width:1800,height:1200});
    }
    await page.setViewportSize({width:1440,height:1200});
    await page.goto(pathToFileURL(path.join(__dirname,'components.html')).href);
    await page.screenshot({path:path.join(__dirname,'components-board.png'),fullPage:true});
    await page.goto(index);
    await page.getByRole('tab',{name:'02 奶油糖果工坊'}).click();
    await page.frameLocator('#mobile').locator('body[data-theme="candy"]').waitFor();
    await page.getByRole('tab',{name:'03 组件对照'}).click();
    if(!await page.locator('#components-box').isVisible())throw new Error('Component tab not visible');
    if(errors.length)throw new Error(errors.join('\n'));
    require('node:fs').writeFileSync(path.join(__dirname,'preview-checks.json'),JSON.stringify({checks,themeSwitch:true,componentTab:true,pageErrors:errors},null,2));
    console.log(JSON.stringify({checks,themeSwitch:true,componentTab:true,pageErrors:errors}));
  }finally{await browser.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
