# 综艺游戏助手

> 把一台手机变成聚会主持人：收录综艺里真实玩过的游戏，按人数现场出题，主持人一个人就能带完全场。
>
> A WeChat Mini Program that turns one phone into a party game host — real games from Chinese variety shows, with AI-generated rounds and a host console.

![Platform](https://img.shields.io/badge/platform-WeChat%20Mini%20Program-07C160?style=flat-square)
![Language](https://img.shields.io/badge/language-JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

---

## 目录

- [这是什么](#这是什么)
- [为什么做这个](#为什么做这个)
- [功能](#功能)
- [界面](#界面)
- [技术架构](#技术架构)
- [快速开始](#快速开始)
- [配置](#配置)
- [目录结构](#目录结构)
- [核心设计](#核心设计)
- [数据结构](#数据结构)
- [测试](#测试)
- [已知限制](#已知限制)
- [Roadmap](#roadmap)
- [合规与免责](#合规与免责)
- [License](#license)

---

## 这是什么

一个微信小程序，面向**线下聚会、团建、露营、KTV**这类场景，解决三个具体问题：

1. **想不起来玩什么** —— 收录多档头部综艺（奔跑吧、现在就出发、王牌对王牌、萌探探探案）中真实玩过的游戏，附完整规则、人数区间、道具需求、当期的名场面。
2. **规则讲不清楚** —— 每个游戏把规则拆成「一句话目标 + 带序号的步骤 + 主持人怎么带」，照着念就能开局。
3. **主持人手忙脚乱** —— 一个人拿手机当主机：发身份、看身份、带节奏、记分，全程不用把手机传给玩家。

内容侧的核心差异是**不写死题目**：猜词、传声筒、飞花令、真假故事这类需要素材的游戏，由大模型按「这个游戏在综艺里的出题思路」现场生成，一组 6-8 条、本机不重复，题库用完自动续。

## 为什么做这个

市面上的聚会游戏 App 大多是把题目写死成静态题库，玩两轮就腻；而综艺游戏的价值恰恰在于「节目里那种出题方式」。所以这个项目的取舍是：

- **规则要准**：只收录有公开报道、能对上期数的游戏，不做编造内容。
- **题目要活**：素材交给模型按节目风格生成，而不是从固定列表里抽。
- **主持人优先**：交互按「一台手机、一个人操作、其他人不看屏」设计，而不是每人一部手机的派对模式。

## 功能

| 模块 | 能力 |
|---|---|
| 游戏库 | 综艺 → 季 → 期 → 游戏四层结构；同名游戏跨期合并（规则相同、词库/名场面不同，可展开选版本） |
| 最新一期轮播 | 每档综艺的最新一期自动上首页，支持手势滑动与 4.5s 自动轮换；1-4 个游戏都能铺满不留白 |
| 搜索 | 一句话定位，支持「现在就出发第4季」「谁是卧底」「狼人杀」等自然表述，综艺名优先于游戏名 |
| 筛选 | 分两组 / 需要场地 / 坐着玩 / 需要动作 / 狼人杀 / 积分赛；筛选后可一键回到全量列表 |
| 规则详情 | 一句话目标、编号步骤、主持人提示、道具、人数、入库时间、当期名场面 |
| 出题引擎 | 按游戏类型识别走不同生成策略；模型失败自动降级到本地题库 |
| 主持人控制台 | 发身份（狼人杀/谁是卧底/笨蛋杀手等）、身份总览与出局标记、分步带节奏、积分板 |
| 数据同步 | 首页静默检查更新，服务端节流 20 小时，多设备只允许一个抢到锁 |

## 界面

单一深色配色（暖墨 `#1A1917`），白天户外可读、夜间不刺眼，不依赖系统深色模式：

- **主色**：暖金 `#E9B15E`，只用于主操作与选中态
- **语义辅助色**：青瓷（分两组）、黛青（需要场地）、陶土（需要动作）、藕紫（狼人杀/身份）
- **综艺归属色**：由综艺名哈希取模分配，名字不变颜色就不变，只落在卡片左边线与期号上
- **动效**：卡片错落浮现、按钮光晕呼吸、轮播按滑动方向进入、出题结果弹入——全部只用 `transform` / `opacity`，不触发重排

设计原则是「彩色必须有含义」：颜色用来区分语义，不用来装饰。

## 技术架构

```
┌─────────────────── 微信小程序（客户端只读）───────────────────┐
│                                                              │
│  pages/index          游戏库、搜索、筛选、轮播                 │
│  pages/game           规则详情、人数设置、开玩入口              │
│  pages/play           主持人控制台、出题、计分                 │
│                                                              │
│  utils/api.js         数据访问 + 增量同步调度                  │
│  utils/gametype.js    类型识别（名字优先三级判定）              │
│  utils/generator.js   单局内容组织（发身份 / 组题）             │
│  utils/wordgen.js     批量出题、去重、预取                     │
│  utils/llm.js         流式调用大模型（SSE）                    │
│  utils/wordbank.js    本地兜底题库                             │
└──────────────┬───────────────────────────┬───────────────────┘
               │                           │
               ▼                           ▼
   ┌───────────────────────┐   ┌──────────────────────────┐
   │ 云数据库 PostgreSQL    │   │ 云端 LLM 代理（免密钥）    │
   │ RLS：客户端只读         │   │ glm-5.3-flash            │
   │                       │   │   └─ 失败 → fast-model    │
   │ shows / episodes      │   └──────────────────────────┘
   │ games / remote_feed   │                │
   │ sync_state            │                └─ 失败 → 本地题库
   └───────────────────────┘
```

数据同步时序（全部静默，用户无感知）：

```
打开首页
├─ getCatalog()
│   ├─ 读 sync_state.data_version
│   ├─ 版本一致 → 用本地缓存（catalog_cache_v2）
│   └─ 版本变化 → 拉 shows / episodes / games 三张表重组
└─ checkForUpdates()
    ├─ last_sync_at 距今 < 20h → 跳过（服务端判断，重装/换机也生效）
    ├─ rpc try_claim_sync(deviceId)         抢锁，同时只有一个设备能进
    ├─ 查 remote_feed where ingested = false limit 2
    ├─ 逐条 rpc ingest_feed_row(id)         单条事务，幂等
    │     └─ 失败 → rpc mark_feed_failed    毒丸跳过，不阻塞队列
    └─ rpc release_sync(owner, bumped, ...) 放锁 + 版本自增 + 留痕
```

## 快速开始

### 前置条件

- 微信开发者工具（稳定版）
- 一个云数据库实例（本项目使用 WorkBuddy 云服务，PostgreSQL + 行级权限）

> **说明**：这是一个「作品 / 技术参考」型仓库，不是 clone 即可运行的模板。原因有两个：① 云端 SDK `@tencent-ai/workbuddy-cloud-sdk` 为托管服务，非公开 npm 包；② 数据库表结构与 RPC 函数需要在实际实例中创建。想完整跑通请见 [配置](#配置) 与 [数据结构](#数据结构)。

### 只想看代码

```bash
git clone https://github.com/haiying-ai/variety-game-host.git
cd variety-game-host
```

用微信开发者工具「导入项目」选择该目录即可浏览、编译页面结构；无云端配置时列表会为空，但页面不会崩。

### 想完整运行

1. 在云服务控制台创建数据库，执行 `_db/migration_hardening_20261102.sql` 建立表、约束与 RPC 函数
2. 执行 `_db/seed_shows.sql` 写入综艺基础数据
3. 复制凭据文件并填入自己的配置：

```bash
cp utils/cloud.local.example.js utils/cloud.local.js
```

4. 在 `utils/cloud.local.js` 填入 `endpoint` 与 `publishableKey`
5. 微信开发者工具导入项目，编译

## 配置

云端凭据**不写在代码里**。`utils/cloud.js` 按以下顺序读取：

1. `utils/cloud.local.js` —— 真实配置，已在 `.gitignore` 中
2. 未找到时回退到占位值，并在控制台告警，接口不可用但页面可渲染

```js
// utils/cloud.local.js（不要提交）
const publicConfig = {
  endpoint: 'https://your-cloud-endpoint.example.com',
  publishableKey: 'YOUR_PUBLISHABLE_KEY',
}
module.exports = { publicConfig }
```

`publishableKey` 是设计上允许出现在客户端的标识键（权限由数据库 RLS 约束），但仍不建议公开——公开意味着别人可以消耗你的调用配额。

## 目录结构

```
.
├── app.js / app.json / app.wxss     全局入口、路由、设计令牌
├── pages
│   ├── index                        游戏库：轮播、搜索、筛选、综艺目录
│   ├── game                         规则详情：步骤、人数、开玩
│   └── play                         主持人控制台：发身份、出题、计分
├── utils
│   ├── api.js                       数据访问 + 增量同步调度 + 版本缓存
│   ├── cloud.js                     云端 SDK 初始化（凭据外置）
│   ├── gametype.js                  游戏类型识别（名字优先三级判定）
│   ├── generator.js                 单局内容组织（发牌 / 组题 / 展示模式）
│   ├── llm.js                       SSE 流式调用 + JSON 容错解析
│   ├── wordgen.js                   批量出题、去重、预取
│   ├── wordbank.js                  本地兜底题库
│   └── workbuddy-cloud-diagnostics.js  云端调用诊断包装
└── _db
    ├── migration_hardening_20261102.sql  表、唯一约束、RPC 函数、RLS 策略
    ├── seed_shows.sql                    综艺基础数据
    ├── feed_batch_20261110.sql           已核实的期数数据（remote_feed 格式）
    ├── selftest_all_games.js             全部游戏出题回归
    ├── selftest_wordgen.js               去重 / 分组 / 续题验证
    └── selftest_pages.js                 详情页 + 玩法页端到端
```

## 核心设计

### 1. 类型识别：名字优先的三级判定

同一份游戏数据在库里字段差异极大（`word_pool` 可能是数组、对象、也可能是带 `challenges` / `poses` / `traps` 的结构）。早期按字段结构猜类型，把「氛围感聊天传声筒」误判成了「谁是凶手」，出题直接跑偏。

现在改成三级判定，**优先级从高到低**：

```
1. 游戏名关键词     /氛围感/ → keywordScene，/英文/ → lineEn，/数字炸弹/ → number
2. play_style 字段  显式声明优先于结构推断
3. 词库结构特征     仅在前两级都无法判定时兜底
```

按交互方式分三类：

- **发牌类**（werewolf / boss / pair / case）：发身份或词语卡、逐个查看、分步引导
- **单张内容类**（传话、诗词、歌词、猜词、声音场景、关键词场景、英文传话、问答、故事、动作、任务、字母、编瞎话）：需要现场生成或抽题，统一走 `wordgen` 管线
- **特殊流程类**（number 数字炸弹、truthdare 真心话大冒险、free 无内容兜底）：不依赖题面，按各自的回合流程走

### 2. 出题管线：批量、去重、预取

单条请求会浪费 token 且必然卡顿，所以按组处理：

```
请求一组 6-8 条（一次 LLM 调用，猜词类 8 条、其余 6 条）
  ├─ 提示词带上：综艺名 + 游戏名 + 玩法规则 + 最近 25 条已用题目
  ├─ 返回后过滤：JSON 解析失败、条数不足、与已用重复的条目全部丢弃
  ├─ 本机 storage 记录已用（保留最近 150 条），跨局不重复
  └─ 剩余 ≤ 2 条时后台静默预取下一组，玩家下一局不用等
```

三层稳定性保障：

| 层级 | 机制 | 效果 |
|---|---|---|
| 模型降级 | `glm-5.3-flash` 失败 → `fast-model` 重试 | 单模型故障不影响出题 |
| 超时中断 | 25s 未完成即中断 | 页面不会一直转圈 |
| 本地兜底 | 全部失败 → `wordbank.js` 本地题库 | 断网、额度用尽也能继续玩 |

### 3. 数据同步：把一致性下沉到数据库

早期版本在客户端做「查重 → 插入 → 更新状态」，多设备并发时会重复入库、锁释放不掉。现在三件事全部交给 PostgreSQL 函数，客户端只负责调度：

- **`try_claim_sync(owner)`** —— 原子抢锁，同时只有一个设备能进
- **`ingest_feed_row(row_id)`** —— 单条 feed 一个事务，靠唯一约束保证幂等，重复调用返回 `already`
- **`mark_feed_failed(row_id, error)`** —— 坏数据标记后跳过（毒丸免疫）
- **`release_sync(owner, bumped, result, error)`** —— 放锁 + `data_version` 自增 + 结果留痕，一步完成

配套的三个唯一约束是幂等的底座：

```sql
episodes(show_id, season, episode_no)
games(episode_id, name)
remote_feed(show_name, season, episode_no)
```

客户端权限收紧为只读（5 张表全部 RLS），写入只能经由 `SECURITY DEFINER` 函数。

### 4. 缓存：版本号比时间戳可靠

每次启动全量拉三张表，数据量上来后明显变慢。现在以 `sync_state.data_version` 作为缓存键：版本没变直接用本地缓存，变了才拉。相比「缓存 N 分钟」，版本号不会出现「刚更新完却看到旧数据」。

## 数据结构

| 表 | 作用 | 关键字段 |
|---|---|---|
| `shows` | 综艺 | `name` |
| `episodes` | 期数 | `show_id`, `season`, `episode_no`, `title` |
| `games` | 游戏 | `episode_id`, `name`, `rules`, `tags`, `min_players`, `max_players`, `word_pool`, `scene` |
| `remote_feed` | 待入库队列 | `show_name`, `season`, `episode_no`, `payload`, `ingested`, `ingest_error` |
| `sync_state` | 同步状态 | `id='global'`, `data_version`, `last_sync_at`, `last_result`, `last_error` |

写入链路是**队列式**的：仓库外的采集任务把核实过的新一期写入 `remote_feed`，小程序在用户打开时顺带消费（每轮最多 2 条，避免长尾阻塞）。这样内容更新和客户端发版完全解耦。

## 测试

无外部依赖，直接跑：

```bash
node _db/selftest_all_games.js    # 逐一遍历全部游戏构建单局，校验不会空题
node _db/selftest_wordgen.js      # 批量出题、去重、组用完自动续
node _db/selftest_pages.js        # 详情页 + 玩法页端到端
```

当前结果：全部游戏通过，出题无重复、按组续题正确，页面端到端通过。

## 已知限制

- **不能 clone 即跑**：依赖托管云服务与私有 SDK，需要自建后端（见 [配置](#配置)）
- **数据量小**：目前仅覆盖数档综艺、数十期节目，且只收录有公开报道能对上期数的内容
- **同步依赖客户端触发**：没有独立服务端定时器，靠「用户打开小程序」驱动队列消费
- **出题质量受模型影响**：本地题库兜底可用，但趣味性明显弱于模型生成
- **未做多语言**：界面与内容均为简体中文

## Roadmap

- [ ] 抽出后端适配层，支持 Supabase / 自建 PostgreSQL 直接接入
- [ ] 游戏收藏与「我常玩的」快捷入口
- [ ] 线下多人同屏（一台设备多端同步，替代传手机）
- [ ] 出题结果的用户反馈（好/不好），用于改进提示词

## 合规与免责

- 本项目仅收录**游戏规则与玩法**，不包含任何综艺节目画面、音频、视频素材
- 综艺名称、期数信息仅用于说明游戏出处，相关权利归各自权利人所有
- 大模型生成的题目为程序实时产物，不代表本项目立场；涉及个人隐私或不适内容请自行跳过
- 若作为小程序上架，需按平台要求完成备案，并在显著位置说明「部分内容由 AI 生成」

## License

[MIT](./LICENSE)

---

如果这个项目对你有帮助，欢迎 Star。有问题请开 Issue，说明「微信开发者工具版本 + 复现步骤 + 预期结果」。
