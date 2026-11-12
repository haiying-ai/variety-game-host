const gen = require('../../utils/generator')
const gt = require('../../utils/gametype')

const TAG_MAP = { '分组': '分两组玩', '场地': '需要场地', '坐玩': '坐着能玩', '动作': '需要动作', '狼人杀': '狼人杀类', '积分': '积分赛' }
// 与 app.wxss 的 tone-* 对应：标签按语义取色
const TAG_CLS = { '分组': 'teal', '场地': 'blue', '坐玩': '', '动作': 'clay', '狼人杀': 'plum', '积分': 'gold' }

/** 把数据库里的规则文本拆成小学生能照着做的步骤 */
function splitSteps(rules) {
  const text = String(rules || '').trim()
  if (!text) return []
  let parts = text.split(/\n+/).map(function (s) {
    return s.replace(/^\s*(?:\d+\s*[.、)）]|[①②③④⑤⑥⑦⑧⑨]|[-*·])\s*/, '').trim()
  }).filter(Boolean)
  if (parts.length <= 1) {
    parts = text.split(/[。；;]/).map(function (s) { return s.trim() }).filter(Boolean)
  }
  return parts.slice(0, 6)
}

Page({
  data: {
    game: {},
    players: 6,
    canPlay: true,
    rolePreview: '',
    tmap: TAG_MAP,
    tcls: TAG_CLS
  },

  onLoad: function (options) {
    const catalog = getApp().globalData.catalog || wx.getStorageSync('catalog_cache')
    if (!catalog) {
      wx.showToast({ title: '游戏库还没加载好', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1200)
      return
    }
    const id = parseInt(options.id, 10)
    let found = null
    let showName = ''
    let season = 0
    let episodeNo = 0
    let epTitle = ''
    catalog.shows.forEach((show) => {
      show.seasons.forEach((sea) => {
        sea.episodes.forEach((ep) => {
          ep.games.forEach((g) => {
            if (g.id === id) {
              found = g
              showName = show.name
              season = sea.season
              episodeNo = ep.episodeNo
              epTitle = ep.title || ('第' + ep.episodeNo + '期')
            }
          })
        })
      })
    })
    if (!found) {
      wx.showToast({ title: '没找到这个游戏', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1200)
      return
    }
    const profile = gt.resolveProfile(found)
    this.profile = profile
    this.showName = showName
    this.setData({
      game: {
        id: found.id,
        name: found.name,
        play_style: found.play_style,
        styleLabel: profile.styleLabel,
        goal: profile.goal,
        howto: profile.howto,
        contentLabel: profile.label,
        rules: found.rules,
        steps: splitSteps(found.rules),
        tags: found.tags || [],
        min_players: found.min_players,
        max_players: found.max_players,
        need_props: found.need_props,
        word_pool: found.word_pool || {},
        scene: found.scene || '',
        addedLabel: found.addedLabel || '',
        showName: showName,
        season: season,
        episodeNo: episodeNo,
        epTitle: epTitle
      },
      players: Math.min(Math.max(found.min_players, 6), found.max_players)
    }, () => this.updatePreview())
  },

  updatePreview: function () {
    const g = this.data.game
    const n = this.data.players
    const profile = this.profile || gt.resolveProfile(g)
    let preview = ''
    const k = profile.kind
    if (k === 'werewolf') {
      const wolves = Math.max(1, Math.floor(n / 4))
      preview = '将自动生成：狼人' + wolves + '名，其余是好人（含预言家等神职）'
    } else if (k === 'boss') {
      preview = '将自动发身份：老板 1 名 + 杀手 1 名（随机暗号动作），其余是好人'
    } else if (k === 'bluff') {
      preview = '每局抽一个词，只有 1 人拿到真实解释，其他人瞎编'
    } else if (k === 'pair') {
      preview = '将自动发词：' + (n >= 9 ? '2 名卧底' : '1 名卧底') + (n >= 8 ? '，还有 1 个白板' : '')
    } else if (k === 'case') {
      preview = '每局随机生成一个案件，其中 1 人是凶手'
    } else if (profile.needContent) {
      preview = '每局由 AI 随机出「' + profile.label + '」，一个人玩也不重复'
    }
    this.setData({ rolePreview: preview })
  },

  decPlayers: function () {
    const g = this.data.game
    if (this.data.players <= g.min_players) return
    this.setData({ players: this.data.players - 1 }, () => this.updatePreview())
  },

  incPlayers: function () {
    const g = this.data.game
    if (this.data.players >= g.max_players) return
    this.setData({ players: this.data.players + 1 }, () => this.updatePreview())
  },

  startPlay: function () {
    if (!this.data.canPlay) return
    const g = this.data.game
    const q = '&show=' + encodeURIComponent(this.showName || '')
    wx.navigateTo({
      url: '/pages/play/play?id=' + g.id + '&players=' + this.data.players + q
    })
  }
})
