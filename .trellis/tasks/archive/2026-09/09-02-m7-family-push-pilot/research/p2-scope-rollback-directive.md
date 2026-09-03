# M7 P2 媒体范围回退唯一指令

## 固定目标

- P1 签署基线：`87b2b387dd629751257fa5c1b96af955e9cb410e`（包含签署文档；P1 业务签署 SHA 为 `529330b1e141dd0210d738e4c05cb5edfb0fef39`）。
- 回退起点：由 Codex 提交本指令后在 Cursor Prompt 中填写完整 SHA。
- 目标：最终运行时代码、migration、依赖、测试与配置等价于 P1 签署基线；保留其后的 P2 planning/review/terminal 文档作为决策记录。
- 本阶段是范围回退，不是 P2 修复；不得保留“以后可能有用”的媒体基础设施。

## RB-01 删除 P2 专属交付

- 删除 P2 专属媒体 Route、UI、module、store/scanner/reencode/validation、migration gate、0029～0031 migration、媒体 E2E/集成/迁移测试。
- 删除 `sharp` 等仅由 P2 引入的直接依赖及 lockfile 记录；恢复 `.gitignore` 中仅服务 P2 临时媒体的规则。
- 删除 P2 对 migration journal、schema、crypto、错误映射、测试配置/数据库 helper、Playwright 配置和 migrate script 的专属改动。

## RB-02 精确恢复共享 P1 文件

- 以 `git diff 87b2b387dd629751257fa5c1b96af955e9cb410e...<回退起点>` 作为完整清单。
- 对共享 Route、页面、client、data-lifecycle、identity 和 family-content 文件，只移除 P2 媒体接线，恢复到 P1 签署基线的行为；不得覆盖 P1 文本/链接、预约、作答、评论、通知、授权和测试。
- 不使用 `git reset`、`git revert`、checkout 覆盖或历史改写；逐文件形成一个可审核的普通回退提交。

## RB-03 保留记录并收敛产品界面

- 保留所有 `research/p2-*.md` 作为 NO-GO/终止证据，不删除或改写历史结论。
- 更新 `research/p2-rollback-record.md`：列出删除项、共享文件恢复项、依赖变化、P1 行为验证和未运行项。
- UI、DTO 与 API 不得暴露上传图片、图片作答、media capability/read 或相关不可用入口。

## RB-04 聚焦验证

- 运行 P1 核心 family-content、API/授权相关聚焦测试，以及 P1 desktop/mobile E2E；不运行全量 test/build/lint/typecheck。
- 运行 migration 聚焦验证，证明最终 journal/schema 回到 P1 的 `0028` 边界，fresh database 不创建媒体表。
- 运行依赖检查，证明生产代码不再引用 `sharp` 或 P2 media module；`git diff --check` clean。
- 不自动 drop/reset 用户数据库；本回退只改变代码库，已执行 P2 migration 的本地开发库后续由 Codex 单独制定恢复操作。

## 交付

- 只创建一个聚焦范围回退提交，不 push、不 merge、不部署。
- 回报完整起点/HEAD、删除与恢复清单、聚焦测试结果、未运行项和工作区状态；结尾写“已交 P2 范围回退审核”。

