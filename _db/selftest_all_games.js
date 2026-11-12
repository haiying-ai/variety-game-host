/**
 * 全量游戏自检：把库里 43 个游戏逐个识别类型并生成一局，
 * 确认每个都有内容、且类型与游戏名匹配。
 * 运行：node _db/selftest_all_games.js
 */
const gt = require('../utils/gametype')
const gen = require('../utils/generator')
const bank = require('../utils/wordbank')

// [id, 名称, play_style, 词库键, 最少人, 最多人]
const GAMES = [
  [48, '捣蛋鱼医生（水上狼人杀）', '水上狼人杀变体', ['hint'], 6, 18],
  [49, '二指追击战', '两根手指按在桌面', [], 3, 12],
  [50, '编瞎话大赏', '一队里只有1人拿到真实解释', ['bluffs'], 4, 16],
  [51, '牦牛接话王', '两人一组情景搭戏接话', ['sentences'], 4, 12],
  [52, '热舞的哞哞', '边跳舞边拍人抢座', [], 4, 15],
  [53, '蒙眼偷题猜词', '身上贴词蒙眼站中间', ['categories'], 4, 12],
  [54, '笨蛋杀手', '好人+老板+杀手', ['boss', 'signals'], 5, 14],
  [55, '不眨眼唱歌', '两队对唱不许眨眼', ['songs'], 4, 16],
  [56, '唱歌演戏', '现发KTV边唱边演', ['songs'], 4, 16],
  [57, '开关灯吃香蕉', '关灯摸黑吃香蕉', [], 4, 14],
  [58, '感应门捣蛋鬼', 'werewolf', ['hint'], 5, 12],
  [59, 'AI问答', 'words', [], 4, 12],
  [60, '卧底推理小游戏', 'undercover', ['hint'], 4, 12],
  [61, '歌词追击', 'song', ['songs'], 4, 14],
  [62, '氛围感聊天传声筒', 'char', ['words', 'scenes'], 3, 12],
  [63, '时间拔河', 'words', ['challenges'], 6, 20],
  [64, '人体履带', 'words', [], 6, 16],
  [65, '幸运撕名牌', 'words', [], 4, 20],
  [66, '人体斯坦尼康', 'words', [], 4, 12],
  [67, '趾压板演技挑战', 'words', ['challenges'], 3, 12],
  [68, '风暴撕名牌', 'werewolf', ['hint'], 6, 20],
  [69, '抓鳗鱼', 'words', [], 3, 12],
  [70, '攻占声母', 'words', ['chars'], 4, 16],
  [71, '泥潭障碍接力', 'words', [], 6, 16],
  [72, '趾压板定格', 'words', ['poses'], 4, 12],
  [73, '拼形识意', 'char', ['words'], 4, 16],
  [74, '弹射飞椅', 'words', ['traps'], 3, 12],
  [75, '人体文字', 'char', ['words'], 6, 16],
  [76, '眼色撕名牌', 'words', [], 5, 16],
  [77, '水球大战', 'words', [], 6, 20],
  [78, '跳绳挑战赛', 'words', [], 6, 16],
  [79, '携手同行', 'words', ['sentences'], 6, 16],
  [80, '藏粉笔', 'words', [], 6, 16],
  [81, '歌词传声筒', 'song', ['songs'], 6, 16],
  [82, '舞出我同伴', 'song', [], 6, 14],
  [83, '目击狼人杀2.0', 'werewolf', ['hint'], 6, 14],
  [84, '拟音传声筒', 'char', ['scenes'], 6, 14],
  [85, '王牌传声筒', 'sentence', ['sentences'], 5, 14],
  [86, '英文版传声筒', 'sentence', ['sentences'], 5, 14],
  [87, '听歌抢答', 'song', ['songs'], 4, 16],
  [88, '蓝水晶智力对抗', 'words', [], 4, 12],
  [89, '吃货狼人杀', 'werewolf', ['hint'], 5, 14],
  [90, '真假故事2.0', 'bluff', [], 5, 14]
]

const EXPECT = {
  '捣蛋鱼医生（水上狼人杀）': 'werewolf',
  '编瞎话大赏': 'bluff',
  '牦牛接话王': 'line',
  '蒙眼偷题猜词': 'word',
  '笨蛋杀手': 'boss',
  '不眨眼唱歌': 'song',
  '唱歌演戏': 'song',
  '感应门捣蛋鬼': 'werewolf',
  'AI问答': 'question',
  '卧底推理小游戏': 'pair',
  '歌词追击': 'song',
  '氛围感聊天传声筒': 'keywordScene',
  '时间拔河': 'task',
  '趾压板演技挑战': 'task',
  '风暴撕名牌': 'werewolf',
  '攻占声母': 'letter',
  '趾压板定格': 'pose',
  '拼形识意': 'word',
  '弹射飞椅': 'task',
  '人体文字': 'word',
  '携手同行': 'poem',
  '歌词传声筒': 'song',
  '目击狼人杀2.0': 'werewolf',
  '拟音传声筒': 'soundScene',
  '王牌传声筒': 'line',
  '英文版传声筒': 'lineEn',
  '听歌抢答': 'song',
  '吃货狼人杀': 'werewolf',
  '真假故事2.0': 'story'
}

let fail = 0
const rows = []
GAMES.forEach(function (g) {
  const pool = {}
  g[3].forEach(function (k) {
    if (k === 'boss') pool.boss = '老板'
    else if (k === 'hint') pool.hint = g[0] === 60 ? '平民与卧底各持一个相近词语，通过描述和投票找出卧底' : '狼人 杀手 角色'
    else if (k === 'categories') pool.categories = [{ name: '词库', words: ['大象'] }]
    else if (k === 'bluffs') pool.bluffs = [{ word: '阿月浑子', real: '开心果的别名' }]
    else pool[k] = ['示例']
  })
  const game = {
    id: g[0], name: g[1], play_style: g[2], word_pool: pool,
    tags: [], rules: '示例规则', min_players: g[4], max_players: g[5]
  }
  const profile = gt.resolveProfile(game)
  const n = Math.min(Math.max(g[4], 6), g[5])
  let item = null
  if (profile.needContent) {
    const list = bank.list(profile.kind)
    item = list.length ? list[Math.floor(Math.random() * list.length)] : null
  }
  const round = gen.buildRound(game, profile, { playerCount: n, names: null, item: item, source: 'local' })
  const hasContent = round.mode === 'cards'
    ? !!(round.cards && round.cards.length === n)
    : (round.mode === 'number' ? typeof round.bomb === 'number'
      : (round.mode === 'truthdare' ? !!(round.truths && round.truths.length)
        : (round.mode === 'free' ? !!round.headline : !!round.word)))
  const exp = EXPECT[g[1]]
  const kindOk = !exp || exp === profile.kind
  if (!hasContent || !kindOk) fail++
  rows.push({
    id: g[0], name: g[1], kind: profile.kind, exp: exp || '-', mode: round.mode,
    content: (round.word || round.title || '').toString().slice(0, 22),
    ok: hasContent && kindOk
  })
})

console.log('id  游戏名                  识别类型       期望类型      展示模式   内容示例                结果')
rows.forEach(function (r) {
  console.log(
    String(r.id).padEnd(4) + r.name.padEnd(24) + r.kind.padEnd(14) + r.exp.padEnd(13) +
    r.mode.padEnd(10) + r.content.padEnd(24) + (r.ok ? 'OK' : 'FAIL')
  )
})
console.log('\n共 ' + rows.length + ' 个游戏，失败 ' + fail + ' 个')
process.exit(fail ? 1 : 0)
