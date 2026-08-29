# M4 技术设计

Family Access 保持 `relationships` 为权威层；membership 从同 family 的 active relationships 聚合重算。Reflection Privacy 独立实现，读取时实时组合 active relationship 与 resource grant。

接受关系时锁定 student/family 的相关关系并复用已有 family；结束关系时只在 parent 或 student 于该 family 不再有任何 active relationship 后写 `left_at`。关系、membership、epoch、grant 撤销、audit 与 outbox 保持同一事务。

私密 reflection 的读取条件为学生本人，或 active relationship 加未撤销的对应 grant；普通 reflection 只要求 active relationship。迁移只追加，不重写历史；回滚时关闭新 Route/consumer，既有授权继续依赖 relationships。
