/** wordgen 调度自检：批量出题、逐条消费、组用完再要一组、已用不重复 */
const path = require('path')
const Module = require('module')

// 内存版 wx.storage
const store = {}
global.wx = {
  getStorageSync: function (k) { return store[k] === undefined ? '' : store[k] },
  setStorageSync: function (k, v) { store[k] = JSON.parse(JSON.stringify(v)) }
}

// 屏蔽真实网络，用假模型返回
const origLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === './cloud' || request.indexOf('workbuddy-cloud-sdk') >= 0) {
    return { publicConfig: { endpoint: 'http://stub', publishableKey: 'wbpk_stub' } }
  }
  return origLoad.call(this, request, parent, isMain)
}

const llm = require('../utils/llm')
const wordgen = require('../utils/wordgen')
const gt = require('../utils/gametype')

let call = 0
llm.generateArray = function () {
  call++
  // 每批都带上批次号，方便肉眼确认是"新一组"
  const items = []
  for (let i = 1; i <= 5; i++) items.push('第' + call + '组-第' + i + '句')
  return Promise.resolve(items)
}

const game = {
  id: 999, name: '测试传声筒', play_style: 'sentence',
  rules: '一个一个往下传', word_pool: { sentences: ['x'] }
}
const profile = gt.resolveProfile(game)

const seen = []
function run(i) {
  return wordgen.nextItem(game, profile).then(function (res) {
    seen.push(res.item)
    console.log('第' + (i + 1) + '局:', res.item, '| 本组还剩', res.remaining, '| 来源', res.source)
    if (i + 1 < 8) return run(i + 1)
  })
}

run(0).then(function () {
  const uniq = seen.filter(function (v, i, a) { return a.indexOf(v) === i })
  console.log('\n共出题', seen.length, '条，去重后', uniq.length, '条')
  console.log('模型调用次数:', call, '（每 5 条一组，8 条应该调用 2 次）')
  const ok = uniq.length === seen.length && call === 2
  console.log(ok ? 'PASS：没有重复，组用完自动再生成' : 'FAIL')
  process.exit(ok ? 0 : 1)
}).catch(function (e) {
  console.error('FAIL', e)
  process.exit(1)
})
