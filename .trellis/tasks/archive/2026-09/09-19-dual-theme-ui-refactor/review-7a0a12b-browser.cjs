// Read-only review: all API requests intercepted; no database writes.
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const base = 'http://127.0.0.1:3002';
const result = { implementationSha: '7a0a12bb5db5fcaca5d38516a1ee0f395abbb686', dataSource: 'all-api-mocked', checks: [] };
async function setup(browser) {
  const context = await browser.newContext();
  const writes = []; let delay = 0;
  let plan = { id: 'review-plan', revision: 1, priority: 0, canEdit: true, bindings: [], ownerId: 'review-student', definition: {title:'Existing',startDate:'2026-09-20',entries:[{key:'item-1',title:'Read',expectedTime:'19:00',latestStartTime:null,durationMinutes:null,repeat:{kind:'daily'},points:{onTimeWithin:10,onTimeOver:0,lateWithin:0,lateOver:0,incomplete:0}}]} };
  await context.route('**/api/**', async route => {
    const req = route.request(), p = new URL(req.url()).pathname;
    const reply = body => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    if (p === '/api/auth/session') return reply({userId:'review-student',role:'student',displayName:'Review',account:'review',contactVerified:true,mustChangePassword:false});
    if (req.method() !== 'GET') {
      writes.push({method:req.method(),path:p,body:req.postDataJSON()});
      if (delay) await new Promise(r=>setTimeout(r,delay));
      if (p === '/api/plan-library') {
        const body = req.postDataJSON();
        plan = {...plan,id:req.method()==='POST' ? `created-${writes.length}` : plan.id,revision:plan.revision+1,definition:body.definition};
        return reply({plan});
      }
      return reply({itemsCreated:1,generatedFrom:'2026-09-20',generatedThrough:'2026-09-20'});
    }
    if (p === '/api/plan-library') return reply({plans:[plan]});
    if (p.endsWith('/schedule-items')) return reply({items:[]});
    if (p.endsWith('/points/balance')) return reply({balance:0});
    if (p.endsWith('/points/summary')) return reply({netPoints:0,entries:[]});
    if (p.includes('goals')) return reply({goals:[]});
    return reply({});
  });
  const page = await context.newPage();
  return {context,page,writes,setDelay:ms=>{delay=ms}};
}
const title = page => page.locator('form input').first();
async function newFilled(page) {
  await page.goto(base+'/student/plans/new',{waitUntil:'networkidle'});
  await title(page).fill('First save');
  await page.locator('form fieldset fieldset input').first().fill('Read');
}
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try {
  {
   const s=await setup(browser); await newFilled(s.page);
   const save=s.page.getByRole('button',{name:'保存计划',exact:true});
   await save.click(); await s.page.getByTestId('student-plan-activate').waitFor();
   await title(s.page).fill('Second save'); await save.click();
   await s.page.waitForTimeout(300);
   result.checks.push({name:'second-save',writes:s.writes.map(w=>({method:w.method,path:w.path,title:w.body.definition?.title}))});
   await title(s.page).fill('Unsaved after second');
   let confirms=0; s.page.on('dialog',async d=>{confirms++;await d.dismiss()});
   await s.page.getByTestId('student-plan-activate').click();
   await s.page.waitForURL('**/student/plans');
   result.checks.push({name:'activate-with-new-draft',confirms,url:s.page.url(),activation:s.writes.at(-1)});
   await s.context.close();
  }
  {
   const s=await setup(browser);
   await s.page.goto(base+'/student/plans/review-plan/edit',{waitUntil:'networkidle'});
   const initial=await s.page.evaluate(()=>history.length);
   await title(s.page).fill('Saved one');
   await s.page.getByRole('button',{name:'保存修改',exact:true}).click();
   await s.page.waitForTimeout(300);
   await title(s.page).fill('Saved two');
   await s.page.getByRole('button',{name:'保存修改',exact:true}).click();
   await s.page.waitForTimeout(300);
   await title(s.page).fill('Unsaved third');
   const final=await s.page.evaluate(()=>history.length);
   let confirms=0;s.page.on('dialog',async d=>{confirms++;await d.accept()});
   await s.page.evaluate(()=>history.back());await s.page.waitForTimeout(600);
   result.checks.push({name:'history-after-two-saves',initial,final,confirms,urlAfterConfirmedBack:s.page.url(),visibleTitle:await title(s.page).inputValue().catch(()=>null)});
   await s.context.close();
  }
  {
   const s=await setup(browser);
   await s.page.goto(base+'/student/plans/review-plan/edit',{waitUntil:'networkidle'});
   await title(s.page).fill('Sent snapshot');s.setDelay(800);
   await s.page.getByRole('button',{name:'保存修改',exact:true}).click();
   await title(s.page).fill('Typed while saving'); await s.page.waitForTimeout(1100);
   let confirms=0;s.page.on('dialog',async d=>{confirms++;await d.dismiss()});
   await s.page.getByRole('button',{name:'取消',exact:true}).click();
   await s.page.waitForTimeout(400);
   result.checks.push({name:'typing-during-save',submittedTitle:s.writes[0]?.body.definition.title,confirms,url:s.page.url()});
   await s.context.close();
  }
 } finally {await browser.close();const file=path.join(os.tmpdir(),'braindance-review-7a0a12b.json');fs.writeFileSync(file,JSON.stringify(result,null,2));console.log(JSON.stringify({...result,evidenceFile:file},null,2));}
})().catch(e=>{console.error(e);process.exitCode=1});
