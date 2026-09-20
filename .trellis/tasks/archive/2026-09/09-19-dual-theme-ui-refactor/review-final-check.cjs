const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const file = 'src/lib/plans/plan-draft-serialization.ts';
const context = { exports: {}, require: () => ({}) };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, context);
const { blankPlanEntry, appendPlanDraftEntry, planFromDefinition, toPlanDefinition } = context.exports;
const remaining = [blankPlanEntry(1)]; // item-1 deleted; item-2 remains
remaining.push(appendPlanDraftEntry(remaining));
const keys = remaining.map(e => e.key);
const source = { title: 'weekly', startDate: '2026-09-19', entries: [{
  key: 'weekly', title: 'Read', expectedTime: '17:00', latestStartTime: null,
  durationMinutes: null, repeat: { kind: 'weekly', weekdays: [1, 3] },
  points: { onTimeWithin: 10, onTimeOver: 0, lateWithin: 0, lateOver: 0, incomplete: 0 },
}] };
const draft = planFromDefinition(source);
draft[0].weeklyWeekdays = []; // deselect all weekday chips
const actual = toPlanDefinition(source.title, '', source.startDate, draft);
const failures = [];
if (new Set(keys).size !== keys.length) failures.push('Delete then add creates duplicate entry keys');
if (actual.entries[0].repeat.weekdays.length) failures.push('Empty weekday selection restores old weekdays silently');
console.log(JSON.stringify({ keys, weekdaysAfterDeselectAll: actual.entries[0].repeat.weekdays, failures }, null, 2));
process.exitCode = failures.length ? 1 : 0;
