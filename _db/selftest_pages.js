/** 页面级自检：详情页能拆步骤，玩法页点"生成新一局"能出内容 */
const Module = require('module')
const path = require('path')

const store = {}
let navUrl = ''
global.wx = {
  getStorageSync: function (k) { return store[k] === undefined ? '' : store[k] },
  setStorageSync: function (k, v) { store[k] = JSON.parse(JSON.stringify(v)) },
  navigateTo: function (o) { navUrl = o.url },
  navigateBack: function () {},
  showToast: function () {},
  request: function () { throw new Error('should not hit network in test') }
}

const catalog = {
  shows: [{
    id: 1, name: '现在就出发', emoji: '🚗',
    seasons: [{
      season: 4, episodes: [{
        id: 11, episodeNo: 5, title: '第5期·怀柔雁栖湖',
        games: [
          {
            id: 62, name: '氛围感聊天传声筒', play_style: 'char',
            tags: ['动作'], rules: '抽一个抽象关键词和一个情景设定，关键词只有表演者知道\n表演者按情景和搭档对话，用无实物表演把关键词的感觉演出来\n表演过程中不能直接说出这个关键词\n搭档根据表演猜词，猜中即过关',
            min_players: 3, max_players: 12, need_props: '题卡',
            word_pool: { words: ['狂野'], scenes: ['搬家师傅与雇主'] },
            scene: '沈腾演狂野', created_at: '2026-11-10T02:00:00Z'
          },
          {
            id: 83, name: '目击狼人杀2.0', play_style: 'werewolf',
            tags: ['狼人杀'], rules: '一人抽到狼，其他人是羊，天黑闭眼，羊轮流睁眼做任务，狼睁眼对视杀羊\n天亮投票指认狼人',
            min_players: 6, max_players: 14, need_props: '西瓜',
            word_pool: { hint: '单狼多羊' }, scene: '沈腾杀羊'
          }
        ]
      }]
    }]
  }]
}

global.getApp = function () { return { globalData: { catalog: catalog } } }

const origLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === './cloud' || request === '../../utils/cloud' || request.indexOf('workbuddy-cloud-sdk') >= 0) {
    return { publicConfig: { endpoint: 'http://stub', publishableKey: 'wbpk_stub' } }
  }
  return origLoad.call(this, request, parent, isMain)
}

// 假模型：按 kind 返回对应结构
const llm = require('../utils/llm')
let calls = 0
llm.generateArray = function (sys, prompt) {
  calls++
  if (prompt.indexOf('抽象关键词') >= 0 || prompt.indexOf('关键词 + 情景') >= 0) {
    return Promise.resolve([
      { word: '尴尬', scene: '电梯里遇到前任' },
      { word: '得意', scene: '考了第一名回家' }
    ])
  }
  return Promise.resolve(['第一句测试内容', '第二句测试内容'])
}

function makePage(file) {
  let cfg = null
  global.Page = function (c) { cfg = c }
  delete require.cache[require.resolve(file)]
  require(file)
  const page = Object.assign({}, cfg)
  page.data = JSON.parse(JSON.stringify(cfg.data))
  page.setData = function (obj, cb) {
    Object.keys(obj).forEach((k) => {
      if (k.indexOf('[') > 0) {
        const m = k.match(/^(\w+)\[(\d+)\]\.(\w+)$/)
        if (m) { page.data[m[1]][Number(m[2])][m[3]] = obj[k]; return }
      }
      page.data[k] = obj[k]
    })
    if (cb) cb()
  }
  return page
}

let failed = 0
function check(label, cond, extra) {
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (extra ? ' | ' + extra : ''))
  if (!cond) failed++
}

// ---- 详情页 ----
const gamePage = makePage('../pages/game/game.js')
gamePage.onLoad({ id: '62' })
check('详情页识别为 keywordScene', gamePage.data.game.styleLabel === '聊天表演 · 关键词', gamePage.data.game.styleLabel)
check('详情页有目标', !!gamePage.data.game.goal, gamePage.data.game.goal)
check('规则拆成 4 步', gamePage.data.game.steps.length === 4, gamePage.data.game.steps.length + ' 步')
check('标明本局会生成什么', !!gamePage.data.game.contentLabel, gamePage.data.game.contentLabel)
gamePage.startPlay()
check('开始游戏带 show 参数', navUrl.indexOf('show=') > 0, navUrl)

// ---- 玩法页：内容类 ----
const playPage = makePage('../pages/play/play.js')
playPage.onLoad({ id: '62', players: '6', show: encodeURIComponent('现在就出发') })
check('玩法页有目标说明', !!playPage.data.goal, playPage.data.goal)
playPage.startGame()
setTimeout(function () {
  const r = playPage.data.round
  check('出题完成（preparing=false）', playPage.data.preparing === false)
  check('有具体内容', !!r.word && r.word.length > 0, r.word)
  check('有关键词+情景', !!r.sub && r.sub.indexOf('情景') >= 0, r.sub)
  check('展示模式为 single', playPage.data.mode === 'single', playPage.data.mode)
  console.log('本局内容示例：', r.word, '/', r.sub)

  // ---- 玩法页：身份类 ----
  const werewolf = makePage('../pages/play/play.js')
  werewolf.onLoad({ id: '83', players: '8', show: encodeURIComponent('现在就出发') })
  werewolf.startGame()
  setTimeout(function () {
    check('狼人杀发身份', werewolf.data.players.length === 8 && werewolf.data.players[0].secret !== '')
    check('狼人杀有主持人指引', werewolf.data.steps.length >= 5, werewolf.data.steps.length + ' 步')
    check('狼人杀有秘密摘要', werewolf.data.secretSummary.length >= 2)
    console.log('\n模型调用次数:', calls)
    console.log(failed ? ('失败 ' + failed + ' 项') : '全部通过')
    process.exit(failed ? 1 : 0)
  }, 30)
}, 60)
