/**
 * 游戏类型识别（按「名字 → play_style → 词库结构」三级判断）
 *
 * 为什么不用原来的 word_pool 结构判断：库里的词库字段很杂
 * （challenges / poses / traps / scenes / words / sentences…），
 * 只看结构会把「氛围感聊天传声筒」误判成"凶手是谁"，导致页面啥也生成不出来。
 * 这里以游戏名为主、字段为辅，保证每个游戏都能落到一个明确的内容种类。
 */

function hasKey(g, k) {
  const p = g.word_pool || {}
  return !!p[k] && (Array.isArray(p[k]) ? p[k].length > 0 : true)
}

function hasCasePool(g) {
  const p = (g.word_pool || {}).scenes || []
  return p.length > 0 && typeof p[0] === 'object' && !!p[0].roles
}

// 每种内容种类的说明（给详情页和玩法页复用，全部按小学生能懂的话写）
const KINDS = {
  werewolf: {
    playMode: 'cards',
    label: '身份卡',
    goal: '好人找出狼人，狼人藏到最后',
    howto: '主持人发身份，天黑大家闭眼，天亮后轮流发言投票，把狼人投出去',
    styleLabel: '身份隐藏 · 狼人杀类'
  },
  boss: {
    playMode: 'cards',
    label: '身份卡',
    goal: '老板和杀手悄悄接头，好人抓住他们',
    howto: '主持人发身份，天黑老板指定目标，白天杀手找老板对暗号动手，好人投票抓人',
    styleLabel: '身份隐藏 · 暗号接头'
  },
  pair: {
    playMode: 'cards',
    label: '词语卡',
    goal: '找出词语和大家不一样的那个人',
    howto: '每人偷偷看一个词，轮流用一句话形容，投票找出卧底',
    styleLabel: '身份隐藏 · 谁是卧底'
  },
  case: {
    playMode: 'cards',
    label: '案件卡',
    goal: '听完全场发言，投票找出凶手',
    howto: '主持人读案件，每人说一句不在场证明，最后投票指认凶手',
    styleLabel: '推理 · 凶手是谁'
  },
  bluff: {
    playMode: 'single',
    label: '本轮词',
    goal: '猜出谁说了解释才是真的',
    howto: '只有一个人知道真实意思，其他人现场瞎编，大家投票选谁是真的',
    styleLabel: '编瞎话 · 猜真假'
  },
  line: {
    playMode: 'single',
    label: '本轮要传的话',
    goal: '把这句话原封不动传到最后一棒',
    howto: '主持人给第一个人看，他小声传给下一个，一个一个传到最后一个，最后一个人大声说出来',
    styleLabel: '传话 · 句子接龙'
  },
  poem: {
    playMode: 'single',
    label: '本轮诗句',
    goal: '把诗句一个字不差地传到最后一棒',
    howto: '主持人给第一个人看诗句，一个一个往下传，最后一个人完整背出来',
    styleLabel: '传话 · 诗句'
  },
  song: {
    playMode: 'single',
    label: '本轮歌曲',
    goal: '用动作把歌词传下去，让最后一棒猜出歌名',
    howto: '主持人给第一个人歌名，他只用动作比划歌词，一个一个往下传，最后一个人说出歌名',
    styleLabel: '唱歌 · 歌词'
  },
  word: {
    playMode: 'single',
    label: '本轮的词',
    goal: '用动作/画画让别人猜出这个词',
    howto: '主持人把词给表演的人看，不能说话不能写字，用动作或身体拼出来让队友猜',
    styleLabel: '猜词 · 表演'
  },
  soundScene: {
    playMode: 'single',
    label: '本轮场景',
    goal: '只用声音把这个场景演出来',
    howto: '表演的人只用嘴和身边小道具发出声音，一个一个往下传，最后一个人说出场景',
    styleLabel: '拟音 · 声音表演'
  },
  keywordScene: {
    playMode: 'single',
    label: '本轮关键词',
    goal: '聊天时把关键词的感觉演出来，让对方猜中',
    howto: '表演的人知道关键词，按情景和搭档聊天演出来，不能说出这个词，搭档猜中算过关',
    styleLabel: '聊天表演 · 关键词'
  },
  lineEn: {
    playMode: 'single',
    label: '本轮英文句子',
    goal: '把英文句子原样传到最后一棒',
    howto: '主持人给第一个人看英文句子，他小声传给下一个，最后一个人完整复述出来',
    styleLabel: '传话 · 英文句子'
  },
  question: {
    playMode: 'single',
    label: '本轮的题',
    goal: '按题目自由回答，答得越有意思越好',
    howto: '主持人念出题目，被点到的人认真回答，其他人判断他是真在思考还是提前想好的',
    styleLabel: '问答 · 题卡'
  },
  story: {
    playMode: 'single',
    label: '本轮故事题目',
    goal: '照着题目现编一个真假难辨的故事',
    howto: '主持人给出故事题目，每人讲一段自己的版本，讲完大家投票猜谁编得最像真的',
    styleLabel: '讲故事 · 猜真假'
  },
  pose: {
    playMode: 'single',
    label: '本轮造型',
    goal: '两人合作摆出这个造型，坚持 5 秒',
    howto: '主持人亮出造型，两个人一起摆出来并保持 5 秒，谁先笑倒谁输',
    styleLabel: '造型 · 定格'
  },
  task: {
    playMode: 'single',
    label: '本轮挑战',
    goal: '在限时内完成这个挑战',
    howto: '主持人念出挑战，选手在 30 秒内完成，完成得分',
    styleLabel: '挑战 · 限时任务'
  },
  letter: {
    playMode: 'single',
    label: '本轮声母',
    goal: '说出带这个声母的词语，接不上就输',
    howto: '主持人给出声母，两队轮流说词语，5 秒内接不上或重复就输一轮',
    styleLabel: '词语 · 声母'
  },
  number: {
    playMode: 'number',
    label: '炸弹数字',
    goal: '别猜中炸弹数字',
    howto: '主持人心里定一个数字，大家轮流报数缩小范围，谁报到炸弹数字谁受罚',
    styleLabel: '猜数 · 数字炸弹'
  },
  truthdare: {
    playMode: 'truthdare',
    label: '真心话 / 大冒险',
    goal: '抽到哪张做哪张',
    howto: '被点到的玩家选真心话或大冒险，主持人念题，做完换下一个人',
    styleLabel: '真心话大冒险'
  },
  free: {
    playMode: 'free',
    label: '自由发挥',
    goal: '按规则自由开玩',
    howto: '按上面的规则和人数自由开玩，主持人负责带节奏和记分',
    styleLabel: '聚会玩法'
  }
}

// 顺序很重要：越具体的玩法越靠前
const RULES = [
  { kind: 'boss', test: function (g) { return /笨蛋杀手/.test(g.name) || g.play_style === 'boss' } },
  {
    kind: 'pair',
    test: function (g) {
      return g.play_style === 'undercover' || /卧底/.test(g.name) || hasKey(g, 'pairs')
    }
  },
  {
    kind: 'werewolf',
    test: function (g) {
      const hint = (g.word_pool || {}).hint || ''
      return g.play_style === 'werewolf' || /狼人杀/.test(g.name) || /狼人|杀手/.test(String(hint))
    }
  },
  { kind: 'bluff', test: function (g) { return /编瞎话/.test(g.name) || hasKey(g, 'bluffs') } },
  { kind: 'story', test: function (g) { return /真假故事|编故事|讲故事/.test(g.name) } },
  { kind: 'question', test: function (g) { return /问答|题卡|快问/.test(g.name) } },
  { kind: 'case', test: function (g) { return /凶手|探案|案件/.test(g.name) || hasCasePool(g) } },
  { kind: 'keywordScene', test: function (g) { return /氛围感/.test(g.name) } },
  { kind: 'soundScene', test: function (g) { return /拟音/.test(g.name) } },
  {
    kind: 'song',
    test: function (g) { return /歌/.test(g.name) || g.play_style === 'song' || hasKey(g, 'songs') }
  },
  { kind: 'poem', test: function (g) { return /诗句|携手|古诗/.test(g.name) } },
  { kind: 'lineEn', test: function (g) { return /英文/.test(g.name) } },
  {
    kind: 'line',
    test: function (g) {
      return /传声筒|接话|台词|悄悄话/.test(g.name) || g.play_style === 'sentence' || hasKey(g, 'sentences')
    }
  },
  { kind: 'pose', test: function (g) { return /定格|造型|姿势/.test(g.name) || hasKey(g, 'poses') } },
  { kind: 'letter', test: function (g) { return /声母|字母/.test(g.name) || hasKey(g, 'chars') } },
  {
    kind: 'task',
    test: function (g) {
      return /拔河|陷阱|抢答|弹射|演技/.test(g.name) || hasKey(g, 'challenges') || hasKey(g, 'traps')
    }
  },
  {
    kind: 'word',
    test: function (g) {
      return /猜词|拼形|人体文字|比划|拼图|猜/.test(g.name) || hasKey(g, 'categories') || hasKey(g, 'words')
    }
  },
  { kind: 'number', test: function (g) { return /数字炸弹/.test(g.name) || g.play_style === 'number' } },
  {
    kind: 'truthdare',
    test: function (g) { return /真心话/.test(g.name) || g.play_style === 'truthdare' }
  }
]

function resolveKind(game) {
  for (let i = 0; i < RULES.length; i++) {
    if (RULES[i].test(game)) return RULES[i].kind
  }
  return 'free'
}

/**
 * 返回这个游戏的完整生成配置。
 * profile.kind 决定「生成什么内容」，profile.playMode 决定「页面怎么展示」。
 */
function resolveProfile(game) {
  const kind = resolveKind(game)
  const meta = KINDS[kind] || KINDS.free
  return {
    kind: kind,
    playMode: meta.playMode,
    label: meta.label,
    goal: meta.goal,
    howto: meta.howto,
    styleLabel: meta.styleLabel,
    // 内容类玩法才需要大模型出题；身份类靠人数分配角色
    needContent: ['bluff', 'line', 'lineEn', 'poem', 'song', 'word', 'soundScene', 'keywordScene', 'pose', 'task', 'letter', 'pair', 'case', 'question', 'story'].indexOf(kind) >= 0
  }
}

module.exports = {
  resolveKind: resolveKind,
  resolveProfile: resolveProfile,
  KINDS: KINDS
}
