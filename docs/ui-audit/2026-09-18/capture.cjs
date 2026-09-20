const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
// Keep frequently written JSON and screenshots outside Next.js's watched tree.
const out = path.join(require('node:os').tmpdir(), 'braindance-ui-audit-20260918');
const base = 'http://127.0.0.1:3002';
async function capture(page, name, url) {
  if(url) await page.goto(base + url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(out, name + '.png'), fullPage: !(await page.getByRole('dialog').count()) });
  const metrics = await page.evaluate(() => ({
    width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
    headings: [...document.querySelectorAll('h1,h2')].map(e => ({text:e.textContent,y:Math.round(e.getBoundingClientRect().y)})),
    navigation: [...document.querySelectorAll('nav')].map(e=>({label:e.getAttribute('aria-label'),width:e.clientWidth,scrollWidth:e.scrollWidth})),
    form: [...document.querySelectorAll('form')].map(e=>({width:Math.round(e.getBoundingClientRect().width),x:Math.round(e.getBoundingClientRect().x)}))
    ,events:[...document.querySelectorAll('.bd-calendar-event')].map(e=>({y:Math.round(e.getBoundingClientRect().y),height:Math.round(e.getBoundingClientRect().height)}))
    ,internalScroll:[...document.querySelectorAll('nav,.bd-calendar-scroll,.bd-calendar,.bd-calendar-week-hours')].filter(e=>e.scrollWidth>e.clientWidth||e.scrollHeight>e.clientHeight).map(e=>({className:e.className,width:e.clientWidth,scrollWidth:e.scrollWidth,height:e.clientHeight,scrollHeight:e.scrollHeight}))
  }));
  fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify(metrics,null,2));
  if(name.startsWith('sample-')) fs.writeFileSync(path.join(out,name+'.txt'),await page.locator('body').innerText());
  console.log(name, new URL(page.url()).pathname, metrics.width, metrics.scrollWidth);
}
const sampleMode = process.argv.includes('--sample');
async function samples(browser) {
  const day = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const students = [{studentId:'sample-student',displayName:'小禾（示例）',username:'sample',relationshipId:'sample-relation'},{studentId:'sample-student-2',displayName:'小远（示例）',username:'sample2',relationshipId:'sample-relation2'}];
  const tasks = ['阅读二十分钟并记录一个有趣的问题','数学练习与错题整理','户外活动','整理书包'].map((title,i)=>({id:'task-'+i,planId:'plan-0',planVersionId:'version-0',studentId:students[0].studentId,ownerId:'sample-parent',familyDate:day,slotKey:'s'+i,scheduledAt:day+'T'+['08:00','17:00','18:00','20:00'][i]+':00+08:00',status:i===0?'completed':'pending',source:'formal_plan',occurrenceKey:'sample-'+i,effectiveStatus:i===0?'completed':'pending',title,planTitle:'放学后的学习与生活',priority:0,startedAt:null,description:'示例内容，仅用于审查布局。',maximumPoints:10,pointsEarned:i===0?10:null,durationMinutes:20}));
  const entries=tasks.map((t,i)=>({key:'e'+i,title:t.title,expectedTime:['08:00','17:00','18:00','20:00'][i],latestStartTime:null,durationMinutes:20,repeat:{kind:'daily'},points:{onTimeWithin:10,onTimeOver:5,lateWithin:3,lateOver:0,incomplete:0}}));
  const plans=['放学后的学习与生活','周末探索与阅读计划','假期自主学习计划：阅读、运动与观察记录'].map((title,i)=>({id:'plan-'+i,revision:1,definition:{title,description:'每天留出时间阅读、运动和整理，让计划更容易坚持。',startDate:day,entries},priority:i,createdAt:day+'T00:00:00Z',updatedAt:day+'T00:00:00Z',bindings:i===1?[]:students.map(s=>({...s,effectiveFrom:day})),ownerId:'sample-parent',ownerName:'家长（示例）',canEdit:true,boundToSelf:true,generatedDatesByStudent:{'sample-student':[day],'sample-student-2':[day]}}));
  const summary={netPoints:10,schedulePoints:10,goalRewards:0,manualAdjustments:0,maximumSchedulePoints:40,entries:[],from:day,through:day};
  for(const role of ['student','parent']) {
    const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
    let empty=false, failure=false;
    const unknown=new Set();
    await ctx.route('**/api/**',async route=>{
      const req=route.request(),u=new URL(req.url()),p=u.pathname;
      const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      // All training responses below are local fixtures; no request reaches the server.
      if(req.method()==='POST' && p==='/api/training/sessions')return reply({sessionId:'sample-session',trainingKey:req.postDataJSON().trainingKey,definitionVersion:1,ageBand:'9-12',familyDate:day,expectedTrialCount:16,status:'active',idempotentReplay:false});
      if(req.method()==='POST' && p.endsWith('/events'))return reply({sequence:req.postDataJSON().sequence,occurredAt:new Date().toISOString(),blurAccumulatedMs:0,abandoned:false});
      if(req.method()!=='GET') return reply({error:'UI audit blocks writes'},409);
      if(p==='/api/auth/session')return reply({userId:role==='student'?'sample-student':'sample-parent',role,displayName:role==='student'?'小禾（示例）':'家长（示例）',account:'sample',contactVerified:true,mustChangePassword:false});
      if(failure)return reply({error:'示例：服务暂时不可用'},503);
      if(p==='/api/family/students')return reply({students:empty?[]:students});
      if(p==='/api/plan-library')return reply({plans:empty?[]:plans.map(v=>({...v,boundToSelf:role==='student'&&v.bindings.some(b=>b.studentId==='sample-student'),ownerId:role==='student'?'sample-student':v.ownerId}))});
      if(p==='/api/goals')return reply({goals:[]});
      if(p.endsWith('/schedule-items'))return reply({items:empty?[]:tasks});
      if(p.endsWith('/points/balance'))return reply({balance:empty?0:120,lastLedgerEntryId:null,updatedAt:null});
      if(p.endsWith('/points/summary'))return reply(empty?{...summary,netPoints:0,schedulePoints:0,maximumSchedulePoints:0}:summary);
      if(p.includes('/training/summary')||p.endsWith('/training-summary'))return reply({traineeId:'sample-student',trainingKey:u.searchParams.get('trainingKey')||'reaction',definitionVersion:1,ageBand:'9-12',familyDate:day,lastSession:null,projection:[]});
      if(p.includes('/training/trends'))return reply({traineeId:'sample-student',segments:[],hasData:false,partialCoverage:false});
      if(p==='/api/push-library')return reply({entries:[],students});
      unknown.add(p); return reply({error:'Unmodeled audit endpoint'},501);
    });
    const page=await ctx.newPage();
    page.on('pageerror',e=>console.log('sample-pageerror',role,e.message));
    const routes=role==='student'?[['home','/'],['plans','/student/plans'],['schedule','/student/plans?view=schedule'],['training','/student/training'],['reaction','/student/training/reaction'],['stroop','/student/training/stroop'],['digit-span','/student/training/digit-span'],['account','/account']]:[['home','/'],['students','/parent/students'],['plans','/parent/plans'],['account','/account']];
    for(const width of (process.argv.includes('--finish') && role==='student'?[]:[1440,360])){
      await page.setViewportSize({width,height:width===360?800:1000});
      for(const [name,url] of routes) await capture(page,`sample-${role}-${name}-${width}`,url);
    }
    if(role==='student'){
      await page.setViewportSize({width:360,height:800});
      if(!process.argv.includes('--finish')){
      const active=await ctx.newPage();
      await active.setViewportSize({width:360,height:800});
      await active.goto(base+'/student/training/reaction',{waitUntil:'networkidle'});
      await active.getByTestId('reaction-start').click();
      await active.getByTestId('training-target').waitFor();
      await capture(active,'sample-student-reaction-active-360');
      await active.close();
      await page.bringToFront();
      await page.goto(base+'/student/plans?view=schedule',{waitUntil:'networkidle'});
      await page.getByRole('button',{name:'周',exact:true}).click();
      await capture(page,'sample-student-calendar-week-360');
      await page.getByRole('button',{name:'月',exact:true}).click();
      await capture(page,'sample-student-calendar-month-360');
      }
      await page.goto(base+'/student/plans',{waitUntil:'networkidle'});
      await page.getByRole('navigation',{name:'我的成长工作台',exact:true}).getByRole('button',{name:'计划',exact:true}).click();
      await page.getByTestId('student-plan-create').click();
      await capture(page,'sample-student-plan-dialog-360');
    }else{
      await page.goto(base+'/parent/plans',{waitUntil:'networkidle'});
      await page.getByTestId('plan-library-create').click();
      await capture(page,'sample-parent-plan-dialog-360');
      await page.setViewportSize({width:1440,height:1000});
      await capture(page,'sample-parent-plan-dialog-1440');
      const focusBefore=await page.evaluate(()=>({inside:!!document.activeElement.closest('[role="dialog"]'),text:document.activeElement.textContent?.slice(0,40)}));
      await page.getByRole('dialog').getByRole('button').last().focus();
      await page.keyboard.press('Tab');
      const focusAfterTab=await page.evaluate(()=>({inside:!!document.activeElement.closest('[role="dialog"]'),tag:document.activeElement.tagName}));
      await page.keyboard.press('Escape');
      fs.writeFileSync(path.join(out,'modal-keyboard.json'),JSON.stringify({focusBefore,focusAfterTab,dialogOpenAfterEscape:await page.getByRole('dialog').count()},null,2));
      await page.goto(base+'/parent/plans',{waitUntil:'networkidle'});
      await page.getByRole('textbox',{name:'搜索计划或内容名称'}).fill('不存在的计划');
      await capture(page,'sample-parent-filter-no-results-1440');
    }
    await page.setViewportSize({width:768,height:1024});
    await capture(page,`sample-${role}-home-768`,'/');
    await page.setViewportSize({width:1024,height:768});
    await capture(page,`sample-${role}-plans-1024`,role==='student'?'/student/plans':'/parent/plans');
    await page.setViewportSize({width:360,height:800});
    empty=true; await capture(page,`sample-${role}-home-empty-360`,'/');
    empty=false;failure=true;await capture(page,`sample-${role}-home-error-360`,'/');
    failure=false;await page.goto(base+'/',{waitUntil:'networkidle'});
    await page.getByTestId('theme-toggle').click();
    await capture(page,`sample-${role}-home-candy-360`);
    fs.writeFileSync(path.join(out,`sample-${role}-unmodeled.json`),JSON.stringify([...unknown],null,2));
    await ctx.close();
  }
}
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try {
    if(sampleMode){await samples(browser);return;}
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    const page=await context.newPage();
    await capture(page,'public-home-desktop','/');
    await capture(page,'login-desktop','/login');
    await page.setViewportSize({width:360,height:800});
    await capture(page,'login-mobile','/login');
    const fixture=JSON.parse(fs.readFileSync(path.join(process.cwd(),'tests/e2e/.fixture.json'),'utf8'));
    await page.getByTestId('login-identifier').fill(fixture.parentEmail);
    await page.getByTestId('login-password').fill(fixture.parentPassword);
    const response=page.waitForResponse(r=>r.url().includes('/api/auth/login') && r.request().method()==='POST');
    await page.getByRole('button',{name:'登录',exact:true}).click();
    const login=await response;
    console.log('existing-test-fixture-login-status',login.status());
    fs.writeFileSync(path.join(out,'access.json'),JSON.stringify({fixtureLoginStatus:login.status()},null,2));
    if(!login.ok())return;
    await page.waitForURL(url=>!url.pathname.startsWith('/login'));
    await capture(page,'parent-home-mobile','/');
    await page.setViewportSize({width:1440,height:1000});
    await capture(page,'parent-home-desktop','/');
    await capture(page,'parent-students-desktop','/parent/students');
    await capture(page,'parent-plans-desktop','/parent/plans');
    await page.setViewportSize({width:360,height:800});
    await capture(page,'parent-plans-mobile','/parent/plans');
  } finally {await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
