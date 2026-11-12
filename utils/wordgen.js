/**
 * 出题调度：先找大模型生成一组，再一条一条发；一组用完再生成下一组。
 * 每个游戏都会把「已经用过的内容」存在本机，单个用户不会重复看到同一道题。
 * 断网/额度用完时自动切到本地题库，保证游戏永远能继续玩下去。
 */

const llm = require('./llm')
const bank = require('./wordbank')

const BATCH_KEEP = 2 // 剩余少于此数就悄悄预生成下一组
const USED_MAX = 150

function batchKey(id) { return 'wg_batch_' + id }
function usedKey(id) { return 'wg_used_' + id }

function itemText(item) {
  if (typeof item === 'string') return item
  return JSON.stringify(item)
}

function readUsed(id) {
  const arr = wx.getStorageSync(usedKey(id))
  return Array.isArray(arr) ? arr : []
}

function writeUsed(id, list) {
  wx.setStorageSync(usedKey(id), list.slice(-USED_MAX))
}

function filterUsed(items, used) {
  return items.filter(function (it) { return used.indexOf(itemText(it)) < 0 })
}

function pickFromBank(profile, used) {
  const pool = bank.list(profile.kind)
  if (!pool.length) return null
  const fresh = filterUsed(pool, used)
  const source = fresh.length ? fresh : pool // 题库全部用完了才允许循环
  return source[Math.floor(Math.random() * source.length)]
}

/* ---------------- 大模型出题 ---------------- */

const SYSTEM = '你是综艺聚会游戏的出题助手。你的回答必须是合法的 JSON 数组，不要任何解释、不要 Markdown 代码块、不要多余文字。'

const STYLE_HINT = {
  line: '像综艺嘉宾现场聊天会说的口语短句，有画面感、有生活细节，10-18 个字，不要文言文，不要出现"游戏""节目"这类词。',
  poem: '选中国人耳熟能详的古诗名句（两句一联），不要生僻诗。',
  song: '选大家都会唱的华语流行歌或儿歌歌名，不要冷门歌。',
  word: '选适合用动作或身体表演的词语，具体、名词为主，避免抽象词。',
  soundScene: '选能只用嘴和手边小道具发出声音的生活场景，8-12 个字。',
  keywordScene: '关键词是一种抽象的情绪或气质（两个字），情景是日常生活里两个人的对话场景。',
  pose: '造型要两个人能一起摆出来，安全、好笑、好模仿。',
  task: '挑战要 30 秒内能完成、安全、不需要危险动作，写清完成标准。',
  letter: '汉语拼音声母，小写。'
}

function buildPrompt(profile, game, count, used, showName) {
  const rules = String(game.rules || '').slice(0, 300)
  const avoid = used.slice(-25).map(function (u) {
    try { return String(JSON.parse(u).word || JSON.parse(u).scene || JSON.parse(u).question || '') } catch (e) { return String(u) }
  }).filter(Boolean)

  const showPart = showName ? ('综艺《' + showName + '》') : '综艺'
  const head = showPart + '里的游戏「' + game.name + '」，玩法是：' + rules + '\n'
  const common = '\n要求：中文、适合小学生、每条都不一样、不要编号。只输出 JSON 数组。'
  const tail = avoid.length ? '\n下面这些已经用过了，不要重复：' + avoid.join('；') : ''

  if (profile.kind === 'word') {
    return head + '请出 ' + count + ' 个可以让人用动作或身体拼出来猜的词语，按这个格式输出：' +
      '[{"cat":"动物","word":"长颈鹿"}]。分类从动物/食物/生活/动作/人物里选。' + common + tail
  }
  if (profile.kind === 'keywordScene') {
    return head + '请出 ' + count + ' 组「抽象关键词 + 情景」，像「狂野 / 搬家师傅与雇主」这样。' +
      '格式：[{"word":"狂野","scene":"搬家师傅与雇主"}]。关键词是两个字的情绪或气质，情景是两个人的日常场景。' + common + tail
  }
  if (profile.kind === 'pair') {
    return head + '请出 ' + count + ' 组「平民词 + 卧底词」，两个词要同类、很像但不一样（比如可乐/雪碧）。' +
      '格式：[["可乐","雪碧"]]' + common + tail
  }
  if (profile.kind === 'case') {
    return head + '请出 ' + count + ' 个适合小学生演的推理小案件。每个案件给一句案情（20-35 字）、4 个角色名、一句真相提示。' +
      '格式：[{"scene":"案情","roles":["角色1","角色2","角色3","角色4"],"hint":"真相"}]' + common + tail
  }
  if (profile.kind === 'bluff') {
    return head + '请出 ' + count + ' 个很少见但真实存在的汉语词，并给出准确、简短的真实意思。' +
      '格式：[{"word":"饕餮","meaning":"古代传说里一种贪吃的神兽"}]。意思必须准确，不确定的词不要写。' + common + tail
  }
  if (profile.kind === 'task') {
    return head + '请出 ' + count + ' 个 30 秒内能完成的小挑战，写清完成标准。格式：["20 秒内读完一段绕口令"]。' + common + tail
  }
  if (profile.kind === 'pose') {
    return head + '请出 ' + count + ' 个两个人能一起摆出来的造型名称。格式：["大鹏展翅"]。' + common + tail
  }
  if (profile.kind === 'letter') {
    return head + '请出 ' + count + ' 个汉语拼音声母（小写）。格式：["m","zh"]。' + common + tail
  }
  if (profile.kind === 'lineEn') {
    return head + '请出 ' + count + ' 句简单的日常英文句子（8-12 个单词），适合传话游戏。格式：["Nice to meet you, my old friend"]。' +
      '\n要求：英文、每句不一样、不要编号。只输出 JSON 数组。' + tail
  }
  if (profile.kind === 'question') {
    return head + '请出 ' + count + ' 个有趣的开放式问题，像综艺里的题卡，答案可以自由发挥，有梗、贴近小学生生活。' +
      '格式：["如果你能和一种动物说话，你会选哪种？"]' + common + tail
  }
  if (profile.kind === 'story') {
    return head + '请出 ' + count + ' 个「讲故事」题目：一句话的校园或生活情境，玩家要照着它现编一个真假难辨的小故事。' +
      '格式：["我在食堂排队时，前面的人突然回头叫了我的名字"]' + common + tail
  }
  // line / poem / song / soundScene 都是纯字符串数组
  return head + '请出 ' + count + ' 条内容，格式：["第一条","第二条"]。' + STYLE_HINT[profile.kind] + common + tail
}

function validateItem(kind) {
  return function (it) {
    if (kind === 'word') return it && typeof it.word === 'string' && it.word.length >= 1 && it.word.length <= 8
    if (kind === 'keywordScene') return it && typeof it.word === 'string' && typeof it.scene === 'string'
    if (kind === 'pair') return Array.isArray(it) && it.length === 2 && typeof it[0] === 'string' && typeof it[1] === 'string'
    if (kind === 'case') return it && typeof it.scene === 'string' && Array.isArray(it.roles) && it.roles.length >= 3
    if (kind === 'bluff') return it && typeof it.word === 'string' && typeof it.meaning === 'string'
    return typeof it === 'string' && it.trim().length >= 2 && it.length <= 50
  }
}

function batchSize(kind) {
  if (kind === 'word') return 8
  if (kind === 'number') return 1
  return 6
}

/** 生成一组题；失败返回 null */
function generateBatch(game, profile, used, showName) {
  const count = batchSize(profile.kind)
  const prompt = buildPrompt(profile, game, count, used, showName)
  return llm.generateArray(SYSTEM, prompt, validateItem(profile.kind)).catch(function () { return null })
}

/* ---------------- 对外接口 ---------------- */

/**
 * 取下一题。返回 Promise<{item, remaining, source, fallback}>
 * source: 'ai' | 'local'；fallback 表示这次大模型没成功、用了本地题库
 */
function nextItem(game, profile, showName) {
  const id = game.id
  const used = readUsed(id)

  let batch = wx.getStorageSync(batchKey(id))
  if (!batch || batch.kind !== profile.kind || !Array.isArray(batch.items)) {
    batch = { kind: profile.kind, items: [] }
  }
  // 清掉本机已经用过的
  batch.items = filterUsed(batch.items, used)
  wx.setStorageSync(batchKey(id), batch)

  if (batch.items.length) {
    const res = take(id, batch, used)
    prefetchIfLow(id, batch, game, profile, used, showName)
    return Promise.resolve(res)
  }

  return generateBatch(game, profile, used, showName).then(function (items) {
    let source = 'ai'
    if (!items || !items.length) {
      const one = pickFromBank(profile, used)
      items = one ? [one] : []
      source = 'local'
    }
    const fresh = filterUsed(items, used)
    batch.items = fresh.length ? fresh : items
    if (!batch.items.length) {
      return { item: null, remaining: 0, source: source, fallback: source === 'local' }
    }
    const res = take(id, batch, used)
    res.source = source
    res.fallback = source === 'local'
    prefetchIfLow(id, batch, game, profile, used, showName)
    return res
  })
}

// 从一组题里取一条，并记录"已用过"
function take(id, batch, used) {
  const item = batch.items.shift()
  used.push(itemText(item))
  writeUsed(id, used)
  wx.setStorageSync(batchKey(id), batch)
  return { item: item, remaining: batch.items.length, source: 'ai', fallback: false }
}

// 一组快用完时，后台悄悄补一组，下一局就不用等
function prefetchIfLow(id, batch, game, profile, used, showName) {
  if (batch.items.length >= BATCH_KEEP) return
  if (batch.__filling) return
  batch.__filling = true
  wx.setStorageSync(batchKey(id), batch)
  setTimeout(function () {
    generateBatch(game, profile, used, showName).then(function (items) {
      const cur = wx.getStorageSync(batchKey(id)) || { kind: profile.kind, items: [] }
      if (!items || !items.length) { cur.__filling = false; wx.setStorageSync(batchKey(id), cur); return }
      const known = (cur.items || []).map(itemText).concat(readUsed(id))
      const add = items.filter(function (it) { return known.indexOf(itemText(it)) < 0 })
      cur.items = (cur.items || []).concat(add)
      cur.__filling = false
      wx.setStorageSync(batchKey(id), cur)
    }).catch(function () {
      const cur = wx.getStorageSync(batchKey(id)) || { kind: profile.kind, items: [] }
      cur.__filling = false
      wx.setStorageSync(batchKey(id), cur)
    })
  }, 800)
}

module.exports = {
  nextItem: nextItem,
  itemText: itemText,
  buildPrompt: buildPrompt,
  validateItem: validateItem,
  batchSize: batchSize
}
