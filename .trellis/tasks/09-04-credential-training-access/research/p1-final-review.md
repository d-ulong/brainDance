# P1 最终审核

- 审核基线：`70472aa0116287e55e8bb20a5487feaa706e31a8`
- 实现提交：`b9b04bc38a8c786c7009bebc353a8abc20e2d03b`
- 集中整改：`9985bc8097445c1aa02ab3b47e614a564cb7845c`
- 结论：**GO**

已确认统一密码 authority、三类密码写入、家长自助改密、确认密码和可访问显示/隐藏均落在 P1 范围内。集中整改恢复了无关测试的 Unicode 文本，并新增回归：改密后旧 session 无效、返回的新 cookie 可认证同一主体。

Codex 独立复验：

```powershell
pnpm test -- tests/unit/identity/password-policy.test.ts tests/integration/identity/identity.test.ts tests/integration/identity/controlled-student.test.ts
```

结果：exit 0，3 files / 14 tests。首次在沙箱受 esbuild 子进程权限限制，正常本机权限下复验通过。未扩大至全量测试。
