# M7 P2 架构返工终审

- 架构返工基线：`3df50b370e4753dd432c804474c32b602ead660b`
- 被审核提交：`4b0421c0b925f4a6253f5bf86a3f99edbc1a0975`
- 结论：**NO-GO；终止 M7 媒体范围，不再整改。**
- 聚焦测试：媒体与迁移共 15/15 通过；`git diff --check` clean。

## 终止原因

1. compatibility gate 在 `migrate()` 之后运行，不兼容开发库可能先应用后续 schema，再被拒绝；没有做到 mutation 前 fail closed。
2. 相同 payload 的并发上传允许多种非确定错误，没有证明幂等请求确定收敛。
3. 四类 purge 不确定性测试没有逐项完整证明中间态不可 attach/read、重试后零引用/能力及单一审计；实施记录夸大证据。

依据 `p2-terminal-review.md` 与 `implement.md` 的预定终止条件，后续唯一动作是执行 `p2-scope-rollback-directive.md`，移除全部 P2 运行时代码与依赖，保留 P1 签署成果和 P2 审核记录。

