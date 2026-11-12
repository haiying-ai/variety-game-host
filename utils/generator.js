/**
 * 生成一局的内容
 *
 * 两种来源：
 *   1) 身份类（狼人杀/卧底/凶手/笨蛋杀手）：按人数分配身份卡，不用出题
 *   2) 内容类（传话/猜词/唱歌/挑战/造型/拟音/编瞎话…）：用 wordgen 取一条内容
 *
 * 所有标题都用游戏本名，不再出现"飞花令"这类和游戏对不上的错误标题。
 */

const gt = require('./gametype')
const bank = require('./wordbank')

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = a[i]; a[i] = a[j]; a[j] = t
  }
  return a
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

/* ---------------- 身份类 ---------------- */

function buildWerewolf(profile, n, label) {
  const wolves = Math.max(1, Math.floor(n / 4))
  const roles = []
  for (let i = 0; i < wolves; i++) roles.push('狼人')
  if (n >= 6) roles.push('预言家')
  if (n >= 8) roles.push('女巫')
  if (n >= 10) roles.push('猎人')
  while (roles.length < n) roles.push('平民')
  const shuffled = shuffle(roles)
  const cards = []
  for (let i = 0; i < n; i++) {
    const secret = shuffled[i]
    let tip = '你是好人，听发言找狼人'
    if (secret === '狼人') tip = '你是狼人，天黑时和同伴商量"吃"谁，白天装好人'
    else if (secret === '预言家') tip = '每晚可以查一个人是好是坏'
    else if (secret === '女巫') tip = '有一瓶解药一瓶毒药，各用一次'
    else if (secret === '猎人') tip = '你出局时可以带走一个人'
    cards.push({ label: label(i), secret: secret, tip: tip })
  }
  return {
    mode: 'cards',
    title: '狼人杀 · ' + n + ' 人局',
    headline: '狼人 ' + wolves + ' 名，其余是好人（含神职）',
    cards: cards
  }
}

function buildUndercover(n, label, pair) {
  const p = pair || pick(bank.list('pair'))
  const undercovers = n >= 9 ? 2 : 1
  const hasBlank = n >= 8
  const roles = []
  for (let i = 0; i < n; i++) roles.push(p[0])
  for (let i = 0; i < undercovers; i++) roles[i] = p[1]
  if (hasBlank && roles.length > undercovers + 2) roles[roles.length - 1] = '白板'
  const shuffled = shuffle(roles)
  const cards = []
  for (let i = 0; i < n; i++) {
    const secret = shuffled[i]
    let tip = '用一句话形容你的词，别说得太明显'
    if (secret === '白板') tip = '你没有词，听别人形容，猜出大家的词'
    else if (secret === p[1]) tip = '你是卧底，你的词和大家不一样，别被听出来'
    cards.push({ label: label(i), secret: secret, tip: tip })
  }
  return {
    mode: 'cards',
    title: '谁是卧底 · ' + n + ' 人局',
    headline: '卧底 ' + undercovers + ' 名' + (hasBlank ? '，还有 1 个白板' : ''),
    cards: cards,
    wordPair: p.join(' / ')
  }
}

function buildCase(n, label, item) {
  const c = item || pick(bank.list('case'))
  const roles = []
  for (let i = 0; i < n; i++) roles.push(i < c.roles.length ? c.roles[i] : ('路人' + (i + 1)))
  const shuffled = shuffle(roles)
  const culprit = Math.floor(Math.random() * n)
  const cards = []
  for (let i = 0; i < n; i++) {
    cards.push({
      label: label(i),
      secret: shuffled[i],
      tip: i === culprit ? '你是凶手，可以说谎掩护自己' : '你不是凶手，说真话帮大家找出来'
    })
  }
  return {
    mode: 'cards',
    title: '谁是凶手 · ' + n + ' 人局',
    headline: '案件：' + c.scene,
    cards: cards,
    caseHint: c.hint || ''
  }
}

function buildBoss(game, n, label) {
  const signals = (game.word_pool && game.word_pool.signals) || [
    '摸一下鼻子', '假装看手表', '咳嗽两声', '摸耳朵', '清一下嗓子', '整理一下袖子'
  ]
  const signal = pick(signals)
  const roles = ['老板', '杀手']
  while (roles.length < n) roles.push('好人')
  const shuffled = shuffle(roles)
  const cards = []
  for (let i = 0; i < n; i++) {
    const secret = shuffled[i]
    let tip = '你是好人，观察谁在偷偷对暗号'
    if (secret === '老板') tip = '天黑时你指定一个要"干掉"的人'
    else if (secret === '杀手') tip = '白天找机会和老板对上暗号：' + signal + '，然后动手'
    cards.push({ label: label(i), secret: secret, tip: tip })
  }
  return {
    mode: 'cards',
    title: '笨蛋杀手 · ' + n + ' 人局',
    headline: '老板 1 名 + 杀手 1 名，暗号动作：' + signal,
    signal: signal,
    cards: cards
  }
}

/* ---------------- 内容类 ---------------- */

function contentRound(game, profile, item, source) {
  const kind = profile.kind
  const round = {
    mode: 'single',
    title: game.name,
    label: profile.label,
    headline: profile.howto,
    source: source === 'local' ? '本地题库' : 'AI 随机出题',
    word: '',
    sub: '',
    extras: []
  }

  if (kind === 'word') {
    round.word = (item && item.word) || '长颈鹿'
    round.sub = '分类：' + ((item && item.cat) || '生活')
  } else if (kind === 'keywordScene') {
    round.word = (item && item.word) || '狂野'
    round.sub = '情景：' + ((item && item.scene) || '搬家师傅与雇主')
  } else if (kind === 'soundScene') {
    round.word = item || '狂风暴雨'
    round.sub = '只用嘴和小道具把这个场景的声音演出来'
  } else if (kind === 'pose') {
    round.word = item || '大鹏展翅'
    round.sub = '两个人一起摆出这个造型，坚持 5 秒'
  } else if (kind === 'task') {
    round.word = item || '20 秒内读完一段绕口令'
    round.sub = '限时 30 秒完成，做到了得分'
  } else if (kind === 'letter') {
    round.word = (item || 'm') + ' 开头的词'
    round.sub = '轮流说出带这个声母的词语，5 秒内接不上就输'
  } else if (kind === 'song') {
    round.word = item || '两只老虎'
    round.sub = '比划歌词，让最后一棒猜出歌名'
  } else if (kind === 'poem') {
    round.word = item || '欲把西湖比西子，淡妆浓抹总相宜'
    round.sub = '一个字都不能差，传到最后一棒'
  } else if (kind === 'lineEn') {
    round.word = item || 'Nice to meet you, my old friend'
    round.sub = '用口语一个传一个，最后一个人完整复述'
  } else if (kind === 'question') {
    round.word = item || '如果你能和一种动物说话，你会选哪种？'
    round.sub = '被点到的人认真回答，其他人判断他是不是提前想好的'
  } else if (kind === 'story') {
    round.word = item || '我在食堂排队时，前面的人突然回头叫了我的名字'
    round.sub = '照着这个开头讲一个真假难辨的小故事'
  } else if (kind === 'bluff') {
    round.word = (item && item.word) || '饕餮'
    round.sub = '只有一个人知道真实意思，其他人现场瞎编'
    round.extras = ['真实意思（主持人看）：' + ((item && item.meaning) || '古代传说里一种贪吃的神兽')]
  } else {
    // line：传话短句
    round.word = item || '我昨天在楼下看到一只特别胖的橘猫'
    round.sub = '一个一个往下传，最后一个人大声说出来'
  }
  return round
}

/* ---------------- 入口 ---------------- */

/**
 * @param game 游戏原始数据
 * @param profile gametype.resolveProfile 的结果
 * @param opts {playerCount, names, item, source}
 */
function buildRound(game, profile, opts) {
  const o = opts || {}
  const n = o.playerCount || 6
  const names = (o.names && o.names.length === n) ? o.names : null
  const label = function (i) { return names ? names[i] : ((i + 1) + ' 号玩家') }

  if (profile.kind === 'werewolf') return buildWerewolf(profile, n, label)
  if (profile.kind === 'boss') return buildBoss(game, n, label)
  if (profile.kind === 'pair') return buildUndercover(n, label, o.item)
  if (profile.kind === 'case') return buildCase(n, label, o.item)

  if (profile.kind === 'number') {
    const pool = game.word_pool || {}
    const min = typeof pool.min === 'number' ? pool.min : 1
    const max = typeof pool.max === 'number' ? pool.max : 100
    return {
      mode: 'number',
      title: '数字炸弹',
      headline: '炸弹藏在 ' + min + ' ~ ' + max + ' 之间',
      bomb: min + Math.floor(Math.random() * (max - min + 1)),
      penalty: (pool.penalties && pool.penalties.length) ? pick(pool.penalties) : '表演一个节目'
    }
  }

  if (profile.kind === 'truthdare') {
    const pool = game.word_pool || {}
    return {
      mode: 'truthdare',
      title: game.name,
      truths: (pool.truths && pool.truths.length) ? pool.truths : bank.list('truth'),
      dares: (pool.dares && pool.dares.length) ? pool.dares : bank.list('dare')
    }
  }

  if (profile.kind === 'free') {
    return {
      mode: 'free',
      title: game.name,
      headline: '按上面的规则和人数自由开玩，主持人负责带节奏和记分'
    }
  }

  return contentRound(game, profile, o.item, o.source)
}

function isGroupGame(game) {
  return (game.tags || []).indexOf('分组') >= 0
}

module.exports = {
  buildRound: buildRound,
  isGroupGame: isGroupGame,
  shuffle: shuffle
}
