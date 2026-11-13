# 参与贡献

题库型小游戏：数据（`_db/*.json`）+ 出题引擎（`_db/selftest_wordgen.js`）+ 页面渲染。

## 本地校验

```bash
node _db/selftest_all_games.js   # 所有游戏数据可解析
node _db/selftest_wordgen.js     # 出题引擎
node _db/selftest_pages.js       # 页面渲染
```

三个脚本都必须通过，CI 跑的是同一组命令。

## 从零跑起来

需要先建库：执行 `_db/schema.sql`（5 张表 + 索引 + 4 个 `SECURITY DEFINER` 函数 + RLS 策略）。该文件是从代码反推的 DDL，如果你用的是已有实例，请先用 `\d+` 核对再加索引。

## 加题库

- 数据文件保持现有结构，新增字段要先改 `selftest_all_games.js` 的校验
- 词条要有明确的正确答案与可接受的同义答案，避免歧义
- 不要收录涉政、涉黄、地域歧视或需要专业知识才能判定的题目

## 提 PR

- 说明是新增题库还是修题目，附上自测输出
- 修改表结构请同时更新 `_db/schema.sql`

安全问题请走 **Security** 页私密报告（本项目的匿名只读是设计意图，不是配置疏漏）。
