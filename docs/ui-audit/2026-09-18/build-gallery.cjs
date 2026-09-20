const fs = require('node:fs');
const path = require('node:path');
const names = fs.readdirSync(__dirname).filter(n => n.endsWith('.png'));
const titles = { home:'首页',plans:'计划',schedule:'日程',training:'训练中心',reaction:'反应训练',stroop:'Stroop训练','digit-span':'数字广度',account:'个人页',students:'学生管理'};
const escape = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
function label(name) {
  if(name==='login-desktop.png')return '登录 · 电脑';
  if(name==='login-mobile.png')return '登录 · 手机';
  if(name==='public-home-desktop.png')return '未登录首页 · 电脑';
  let s=name.replace('sample-student-','学生 · ').replace('sample-parent-','家长 · ').replace('.png','');
  for(const [key,value] of Object.entries(titles))s=s.replace(key,value);
  return s.replace('calendar-week','日历周视图').replace('calendar-month','日历月视图').replace('plan-dialog','计划编辑弹窗').replace('filter-no-results','筛选无结果').replace('active','进行态').replace('empty','空数据').replace('error','读取失败').replace('candy','糖果主题').replaceAll('-',' · ');
}
const priority = ['sample-student-home-360.png','sample-student-schedule-360.png','sample-parent-plans-360.png','sample-parent-plan-dialog-360.png','sample-student-reaction-active-360.png','sample-parent-filter-no-results-1440.png','login-desktop.png'];
names.sort((a,b)=>{const ai=priority.indexOf(a),bi=priority.indexOf(b);return(ai<0?999:ai)-(bi<0?999:bi)||a.localeCompare(b)});
const cards=names.map(name=>{
  const mobile=name.includes('360')||name.includes('mobile');
  const role=name.includes('student')?'student':name.includes('parent')?'parent':'public';
  const device=mobile?'mobile':name.includes('768')||name.includes('1024')?'tablet':'desktop';
  return `<article data-role="${role}" data-device="${device}"><div class="card-title"><h2>${escape(label(name))}</h2><span>${role==='public'?'真实公开页面':'示例数据'}</span></div><div class="image-frame ${mobile?'mobile':''}"><a href="${name}" target="_blank" rel="noopener"><img src="${name}" loading="lazy" alt="${escape(label(name))}"></a></div><footer><a href="${name}" target="_blank" rel="noopener">查看原始截图 ↗</a><a href="${name.replace('.png','.json')}">尺寸记录</a></footer></article>`;
}).join('\n');
fs.writeFileSync(path.join(__dirname,'gallery.html'),`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BrainDance · UI审查画廊</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f5f5f2;color:#202c35;font:16px/1.65 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1280px;margin:auto;padding:32px 24px}h1{font-size:30px;margin:8px 0}h2{font-size:16px;margin:0}p{max-width:920px}a{color:#4e46b8;text-underline-offset:3px}.eyebrow{font-size:12px;letter-spacing:2px;color:#657275}.notice{padding:16px 20px;background:#fff6dd;border-left:4px solid #b78427;border-radius:8px}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:24px 0}.summary div{padding:16px;background:white;border-radius:12px;border:1px solid #e0e4e5}.summary strong{display:block;margin-bottom:4px}.controls{display:flex;gap:16px;flex-wrap:wrap;padding:16px 0;position:sticky;top:0;background:#f5f5f2;z-index:2}label{display:flex;align-items:center;gap:8px}select{font:inherit;padding:8px 12px;border-radius:8px;border:1px solid #c7cdce;background:white}#count{align-self:center;color:#667075}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}article{background:white;border:1px solid #dce1e2;border-radius:14px;overflow:hidden;align-self:start}.card-title{padding:16px;display:flex;justify-content:space-between;align-items:center;gap:10px}.card-title span{font-size:12px;color:#6d603d;white-space:nowrap;background:#f6eedb;border-radius:4px;padding:2px 6px}.image-frame{height:600px;overflow:auto;background:#e9ecef;border-block:1px solid #e4e7e7;padding:12px}.image-frame img{display:block;width:100%;height:auto}.image-frame.mobile img{max-width:360px;margin:auto}.image-frame a{display:block}footer{padding:12px 16px;display:flex;justify-content:space-between;font-size:13px}article[hidden]{display:none}@media(max-width:720px){main{padding:20px 12px}.summary,.grid{grid-template-columns:1fr}h1{font-size:25px}.image-frame{height:540px}}
</style></head><body><main><div class="eyebrow">BRAINDANCE / UI REVIEW / 2026.09.18</div><h1>先让任务更清楚，再统一视觉</h1><p>本页展示当前界面证据，不是改版效果图。先看学生首页、日程和家长计划管理，再结合审查报告决定布局方向。</p>
<div class="notice"><strong>证据范围：</strong>44张截图中，3张为真实未登录页面，41张为现有组件搭配浏览器内示例数据。现有测试账号登录返回401，未验证真实家庭流程。左下角Next.js标识属于开发环境。<br><a href="review.md">完整问题清单、建议与验收标准 →</a></div>
<div class="summary"><div><strong>学生：行动优先</strong>压缩欢迎横幅和重复概览，把下一项任务放到首屏。</div><div><strong>家长：管理清楚</strong>明确当前学生，简化导航、筛选和卡片操作。</div><div><strong>手机：重新组织内容</strong>日程优先列表，复杂表单分组，训练使用专注布局。</div></div>
<div class="controls"><label>角色<select id="role"><option value="all">全部</option><option value="student">学生</option><option value="parent">家长</option><option value="public">未登录</option></select></label><label>设备<select id="device"><option value="all">全部</option><option value="mobile">手机 360</option><option value="tablet">平板 / 窄桌面 768–1024</option><option value="desktop">电脑 1440</option></select></label><span id="count" aria-live="polite"></span></div>
<div class="grid">${cards}</div><p>各图片框内可滚动查看长页面，也可打开原图。当前结论为待定稿建议，未实施UI变更。</p></main>
<script>const role=document.querySelector('#role'),device=document.querySelector('#device'),cards=[...document.querySelectorAll('article')];function filter(){let count=0;for(const card of cards){card.hidden=!((role.value==='all'||card.dataset.role===role.value)&&(device.value==='all'||card.dataset.device===device.value));if(!card.hidden)count++}document.querySelector('#count').textContent=count+' 张截图'}role.addEventListener('change',filter);device.addEventListener('change',filter);filter();</script></body></html>`);
console.log('Gallery written:',names.length,'screenshots');
