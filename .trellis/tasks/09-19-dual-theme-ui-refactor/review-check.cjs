// Read-only, DB-free reproduction of the plan edit serialization regression.
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const file = 'src/lib/plans/plan-draft-serialization.ts';
const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const context = { exports: {}, require: () => ({}) };
vm.runInNewContext(js, context, { filename: file });
const before = { title: '原计划', startDate: '2026-09-19', entries: [{
  key: 'existing-key', title: '阅读', expectedTime: '17:00',
  latestStartTime: '17:10', durationMinutes: 20, repeat: { kind: 'daily' },
  points: { onTimeWithin: 10, onTimeOver: 5, lateWithin: 3, lateOver: 1, incomplete: -2 },
}] };
const after = context.exports.toPlanDefinition(
  before.title,
  '',
  before.startDate,
  context.exports.planFromDefinition(before),
);
const changes = ['key', 'latestStartTime', 'durationMinutes', 'points'].filter(
  key => JSON.stringify(before.entries[0][key]) !== JSON.stringify(after.entries[0][key]));
console.log(JSON.stringify({ source: file, changes, before, after }, null, 2));
if (changes.length) process.exitCode = 1;
