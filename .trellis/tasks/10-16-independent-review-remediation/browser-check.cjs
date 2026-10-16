const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

// UI contract fixtures only. Database invariants are verified separately.
const root = path.join(__dirname, 'evidence');
const subject = '11111111-1111-4111-8111-111111111111';
const day = '2026-10-16';
const errors = [];
const results = [];
const baseItem = {
  id:'task-completed', planId:'plan', planVersionId:'version', studentId:subject,
  ownerId:subject, familyDate:day, slotKey:'morning', scheduledAt:`${day}T01:00:00Z`,
  status:'completed',source:'personal',occurrenceKey:'one', effectiveStatus:'completed',
  title:'阅读与记录',planTitle:'每天进步一点',priority:10,startedAt:`${day}T01:00:00Z`,
  completedAt:`${day}T01:30:00Z`,executionRevision:2,executionAllCompleted:true,
  canStart:false,canComplete:false,canEditExecution:true,canCorrect:true,
  editDeadline:'2026-10-16T16:00:00Z',taskType:'homework',pointsEarned:10,maximumPoints:10,
  checklist:[{id:'child',title:'阅读一章',completed:true,difficulty:'适中',durationMinutes:30,
    startedAt:`${day}T01:00:00Z`,completedAt:`${day}T01:30:00Z`,
    pomodoro:{state:'stopped',startedAt:`${day}T01:00:00Z`,stoppedAt:`${day}T01:30:00Z`,pausedSeconds:60,pauseCount:1,focusedSeconds:1740}}],
  pomodoro:{state:'stopped',startedAt:`${day}T01:00:00Z`,stoppedAt:`${day}T01:30:00Z`,pausedSeconds:60,pauseCount:1,focusedSeconds:1740},
};
const summary = {netPoints:10,schedulePoints:10,maximumSchedulePoints:20,goalRewards:0,manualAdjustments:0};

(async()=>{
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    for(const theme of ['space','candy']) for(const width of [1280,360]) {
      const context=await browser.newContext({viewport:{width,height:900},timezoneId:'America/Los_Angeles'});
      const page=await context.newPage();
      await page.clock.setFixedTime(new Date('2026-10-16T04:00:00Z'));
      await page.addInitScript(theme=>localStorage.setItem('braindance-theme',theme),theme);
      page.on('pageerror',e=>errors.push(e.message));
      const writes=[];const summaries=[];
      await page.route('**/api/**',async route=>{
        const req=route.request();const u=new URL(req.url());let body={};
        if(req.method()!=='GET') {
          writes.push({url:u.pathname,body:req.postDataJSON()});
          body={revision:3,checklist:baseItem.checklist,pomodoro:baseItem.pomodoro,idempotentReplay:false};
        } else if(u.pathname==='/api/auth/session') body={userId:subject,role:'student',contactVerified:true,displayName:'测试学生'};
        else if(u.pathname==='/api/plan-library') body={plans:[]};
        else if(u.pathname==='/api/goals') body={goals:[]};
        else if(u.pathname.endsWith('/schedule-items')) body={items:[baseItem,{...baseItem,id:'task-expired',title:'已过期任务',status:'pending',effectiveStatus:'expired',canEditExecution:false,canCorrect:false,checklist:[]}]};
        else if(u.pathname.endsWith('/points/summary')) {body=summary;summaries.push(u.searchParams.toString());}
        else if(u.pathname.endsWith('/points/balance')) body={balance:100};
        else throw new Error('Unexpected UI fixture request: '+u.pathname);
        await route.fulfill({json:body});
      });
      await page.goto(`http://127.0.0.1:3004/student/plans?view=schedule&date=${day}&item=task-completed`);
      const workspace=page.getByTestId('student-schedule-workspace');
      await expect(workspace).toBeVisible();
      const card=workspace.getByTestId('student-schedule-item-task-completed').filter({visible:true});
      await expect(card.getByRole('button',{name:'更正完成记录'})).toBeVisible();
      await expect(workspace.getByRole('button',{name:'完成任务',exact:true})).toHaveCount(0);
      await card.getByRole('button',{name:'更正完成记录'}).click();
      const dialog=page.getByRole('dialog');
      await expect(dialog.getByLabel('开始时间',{exact:true})).toHaveValue('2026-10-16T09:00');
      await dialog.getByLabel(/更正原因/).fill('修正实际记录');
      await dialog.getByRole('button',{name:'保存更正'}).click();
      await expect.poll(()=>writes.length).toBe(1);
      expect(writes[0].url).toBe('/api/schedule-items/task-completed/correct');
      expect(writes[0].body.expectedRevision).toBe(2);
      expect(writes[0].body.startedAt).toBe('2026-10-16T01:00:00.000Z');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByRole('button',{name:'关闭提示'}).click();
      const metrics = await card.locator('.bd-calendar-event-actions button:enabled').evaluateAll(buttons => buttons.map(button => {
        const style=getComputedStyle(button),rect=button.getBoundingClientRect();
        const lum = value => { const [r,g,b]=value.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4); return r*0.2126+g*0.7152+b*0.0722; };
        const a=lum(style.color),b=lum(style.backgroundColor);
        return {width:rect.width,height:rect.height,contrast:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)};
      }));
      for(const metric of metrics) {expect(metric.width).toBeGreaterThanOrEqual(44); expect(metric.height).toBeGreaterThanOrEqual(44); expect(metric.contrast).toBeGreaterThanOrEqual(4.5);}
      await page.screenshot({path:path.join(root,`schedule-${theme}-${width}.png`),fullPage:true});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await workspace.getByRole('button',{name:'月',exact:true}).click();
      await expect.poll(()=>summaries.some(q=>q.includes('from=2026-10-01')&&q.includes('through=2026-10-31'))).toBe(true);
      results.push({theme,width,correction:true,shanghaiInput:true,monthSummary:true,noHorizontalOverflow:true,actionContrastMinimum:Math.min(...metrics.map(m=>m.contrast))});
      await context.close();
    }
    const context=await browser.newContext({viewport:{width:360,height:900}});
    const page=await context.newPage();let redeemed=false;let submitted=false;
    page.on('pageerror',e=>errors.push(e.message));
    const reward={id:'reward',studentId:subject,creatorParentId:subject,title:'休息一会',cost:20,active:true,description:null,monthlyLimit:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    await page.route('**/api/**',async route=>{
      const req=route.request();const u=new URL(req.url());let body={};
      if(u.pathname==='/api/auth/session') body={userId:subject,role:'parent',contactVerified:true,displayName:'家长'};
      else if(u.pathname.endsWith('/points/balance')) body={balance:redeemed?80:100};
      else if(u.pathname.endsWith('/redemption-catalog')) {
        if(req.method()==='POST'){submitted=true;body={item:reward};}else body={items:[reward]};
      } else if(u.pathname.endsWith('/redemptions')) {
        if(req.method()==='POST'){redeemed=true;body={redemption:{id:'redemption',status:'approved'},idempotentReplay:false};}
        else body={redemptions:redeemed?[{id:'redemption',catalogItemId:'reward',costSnapshot:20,status:'approved',requestedAt:new Date().toISOString()}]:[]};
      } else throw new Error('Unexpected redemption request '+u.pathname);
      await route.fulfill({json:body});
    });
    await page.goto('http://127.0.0.1:3004/parent/my-redemption');
    await page.getByLabel('奖励名称').fill('休息一会');
    await page.getByRole('button',{name:'保存奖励',exact:true}).click();
    await expect.poll(()=>submitted).toBe(true);
    await page.getByRole('button',{name:'兑换',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:/确认/}).click();
    await expect.poll(()=>redeemed).toBe(true);
    await expect(page.getByRole('heading',{name:'我的积分 80'})).toBeVisible();
    await page.screenshot({path:path.join(root,'parent-self-redemption-360.png'),fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    results.push({parentSelfRedemption:true,formSubmission:true,confirmedDebitDisplay:true});
    await context.close();
    expect(errors).toEqual([]);
    await fs.writeFile(path.join(root,'browser-results.json'),JSON.stringify({fixtureUI:true,results,errors},null,2));
    console.log(JSON.stringify(results));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
