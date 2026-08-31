# M5 P2 签署记录

> 状态：**GO**
>
> 固定实现 SHA：`a9b32f20fd419ed9e5b6f02d818c5553764bbdb8`
>
> P2 原始执行基线：`f43f4628b682df7991786bf77dc28993b5880844`

## 已覆盖

- R-M5-05 / AC-M5-05：`7d | 30d | all`、Asia/Shanghai 家庭日期、无数据/部分覆盖、定义版本和年龄档 segment 分隔。
- R-M5-05 / AC-M5-06：只消费 completed/effective；排除 practice/invalid/abandoned/cancelled；增量与 rebuild 共用 reducer，完整 row parity 包括 `lastFamilyDate`。
- AC-M5-07 / R-M5-08：学生本人、实时 active 家长、多家长解除关系矩阵及不泄露存在性的统一拒绝语义。
- P2-R01～R04：全量 orphan 清理、lastFamilyDate 更新、共享 reducer，以及 full rebuild 与 submit 的事务级 advisory-lock 协调均关闭。

## 独立质量证据

- Codex 固定 SHA 两轴审核：Standards 0 个阻断，Spec 0 个阻断。
- Codex 独立串行复验：`tests/integration/projection` 2 files / 11 tests 通过；`m5-trends.test.ts` 1 file / 11 tests 通过；`pnpm typecheck` 与固定 diff check 退出 0。
- Cursor 记录：API trends 1 file / 6 tests、family-access 3 files / 28 tests、unit training 5 files / 44 tests 通过；lint 0 errors / 3 个既有 warnings；format 通过。

## 非阻断债与未覆盖范围

- full rebuild 期间全局锁会提高 submit 延迟；100ms 调度等待、production options 中的 test hook、底层 per-student helper 未自行取锁均不构成当前生产入口缺陷，留作后续技术债。
- P1-R32/R35～R38 测试 helper 诊断债不属于 P2。
- R-M5-06～07、AC-M5-08～10 的 UI、输入/失焦/弱网与双视口全量验收由 P3 承担。

结论：P2 GO，准许从签署/指令提交开始执行 P3；P2 GO 不代表 M5 完成。
