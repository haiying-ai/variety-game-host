const api = require('../../utils/api')

// 标签元数据：筛选条/列表色点共用。cls 对应 app.wxss 里的 tone-* 色彩语义
const TAG_META = {
  '分组': { cls: 'teal', name: '分两组' },
  '场地': { cls: 'blue', name: '要场地' },
  '坐玩': { cls: '', name: '坐着玩' },
  '动作': { cls: 'clay', name: '要动作' },
  '狼人杀': { cls: 'plum', name: '狼人杀' },
  '积分': { cls: 'gold', name: '积分赛' }
}
/** 给游戏补上标签展示文案与入库时间（不再有 NEW 徽标） */
function decorateGame(g) {
  const meta = (g.tags || []).map((t) => TAG_META[t]).filter(Boolean)
  g.tagsMeta = meta
  g.addedLabel = ''
  if (g.created_at) {
    const t = new Date(g.created_at).getTime()
    if (!isNaN(t)) {
      const d = new Date(t)
      g.addedLabel = (d.getMonth() + 1) + '月' + d.getDate() + '日入库'
    }
  }
  return g
}

const CATEGORIES = [
  { value: '全部', label: '全部', cls: '' },
  { value: '分组', label: '分两组玩', cls: 'teal' },
  { value: '场地', label: '需要场地', cls: 'blue' },
  { value: '坐玩', label: '坐着玩', cls: '' },
  { value: '动作', label: '需要动作', cls: 'clay' },
  { value: '狼人杀', label: '狼人杀', cls: 'plum' },
  { value: '积分', label: '积分赛', cls: 'gold' }
]

// 辅助色循环：每档综艺一个固定归属色（按 id 取模，排序变化也不变色）
const TONES = ['gold', 'teal', 'blue', 'plum']

Page({
  data: {
    loading: true,
    categories: CATEGORIES,
    activeCat: '全部',
    query: '',
    shows: [],
    catGroups: [],
    locatedGroups: [],
    searchBanner: '',
    banners: [],
    bnIndex: 0,
    bnDir: 'next',
    catInto: '',
    loadError: ''
  },

  onLoad: function () {
    this.refresh()
  },

  onShow: function () {
    this.startBannerTimer()
  },

  onHide: function () {
    this.stopBannerTimer()
  },

  onUnload: function () {
    this.stopBannerTimer()
  },

  // 轮播自动切换：单卡轮换（比 swiper 组件兼容性更好），多张时 4.5 秒换一张
  startBannerTimer: function () {
    this.stopBannerTimer()
    const n = (this.data.banners || []).length
    if (n > 1) {
      this._bnTimer = setInterval(() => {
        this.setData({
          bnIndex: (this.data.bnIndex + 1) % this.data.banners.length,
          bnDir: 'next'
        })
      }, 4500)
    }
  },

  stopBannerTimer: function () {
    if (this._bnTimer) {
      clearInterval(this._bnTimer)
      this._bnTimer = null
    }
  },

  onDot: function (e) {
    const i = Number(e.currentTarget.dataset.i) || 0
    this.setData({ bnIndex: i, bnDir: i >= this.data.bnIndex ? 'next' : 'prev' })
    this.startBannerTimer() // 重置计时，避免刚点完就自动跳走
  },

  // 手指左右滑动切换轮播
  onBnTouchStart: function (e) {
    const t = e.touches[0]
    this._bnStartX = t.clientX
    this._bnStartY = t.clientY
  },

  onBnTouchEnd: function (e) {
    if (this._bnStartX === undefined || this._bnStartX === null) return
    const t = e.changedTouches[0]
    const dx = t.clientX - this._bnStartX
    const dy = t.clientY - this._bnStartY
    this._bnStartX = null
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy)) return
    const n = this.data.banners.length
    if (n < 2) return
    const next = dx < 0
      ? (this.data.bnIndex + 1) % n
      : (this.data.bnIndex - 1 + n) % n
    this.setData({ bnIndex: next, bnDir: dx < 0 ? 'next' : 'prev' })
    this.startBannerTimer()
  },

  onPullDownRefresh: function () {
    this.refresh().then(() => wx.stopPullDownRefresh())
  },

  onShow: function () {
    // 静默更新：后台按服务端 20 小时节流检查一次，有新内容就自动重载列表。
    // 页面不提供任何手动更新入口，更新节奏完全由本地自动化任务 + 服务端节流控制。
    this.runUpdate()
  },

  refresh: function () {
    this.setData({ loading: true })
    // getCatalog 带服务端 data_version 缓存：版本没变直接用本地缓存，变了才全量拉
    return api.getCatalog().then((catalog) => {
      getApp().globalData.catalog = catalog
      wx.setStorageSync('catalog_cache', catalog)
      this.applyCatalog(catalog)
    }).catch((err) => {
      const cached = wx.getStorageSync('catalog_cache')
      if (cached && cached.shows && cached.shows.length) {
        this.applyCatalog(cached)
        this.setData({ loadError: '网络不太好，先看缓存的游戏库' })
      } else {
        this.setData({
          loading: false,
          loadError: '加载失败：' + (err.message || '网络不给力，稍后再试')
        })
      }
    })
  },

  applyCatalog: function (catalog) {
    // 期数已按时间倒序（最新在前）。标记每档综艺的最新一期 = 最大季的第 1 条
    catalog.shows.forEach((show) => {
      const latestSea = show.seasons.length ? show.seasons[0].season : -1
      show.seasons.forEach((sea) => {
        sea.episodes.forEach((ep, idx) => {
          ep.games.forEach((g) => decorateGame(g))
          ep.isLatest = (sea.season === latestSea && idx === 0)
        })
      })
      // 综艺按"最新一期"的时间倒序排：越新播的综艺越靠上
      show.latestKey = show.seasons.length
        ? show.seasons[0].season * 1000 + (show.seasons[0].episodes[0] ? show.seasons[0].episodes[0].episodeNo : 0)
        : 0
      // 归属色：由综艺名计算，名字不变颜色就不变（排序变动也不会串色）
      let h = 0
      for (let k = 0; k < show.name.length; k++) h = (h * 31 + show.name.charCodeAt(k)) % 997
      show.toneName = TONES[h % TONES.length]
    })
    catalog.shows.sort((a, b) => b.latestKey - a.latestKey)
    catalog.shows.forEach((s) => { s.open = true })
    this.catalog = catalog

    // 平铺游戏索引：分类筛选 + 搜索用
    const flat = []
    catalog.shows.forEach((show) => {
      show.seasons.forEach((sea) => {
        sea.episodes.forEach((ep) => {
          ep.games.forEach((g) => {
            flat.push({
              id: g.id,
              name: g.name,
              tags: g.tags,
              tagsMeta: g.tagsMeta || [],
              style: g.play_style || '',
              scene: g.scene || '',
              min_players: g.min_players,
              max_players: g.max_players,
              addedLabel: g.addedLabel,
              showName: show.name,
              season: sea.season,
              episodeNo: ep.episodeNo,
              epTitle: ep.title || ('第' + ep.episodeNo + '期')
            })
          })
        })
      })
    })
    this.flatGames = flat

    // 顶部轮播：每档综艺最新一期的游戏。数据一变（新一期入库）轮播自动跟着变
    const banners = []
    catalog.shows.forEach((show, i) => {
      const sea = show.seasons[0]
      if (!sea || !sea.episodes.length) return
      const ep = sea.episodes[0]
      const games = ep.games || []
      if (!games.length) return
      const bnGames = games.slice(0, 4).map((g) => ({
        id: g.id,
        name: g.name,
        players: g.min_players + '-' + g.max_players + '人'
      }))
      banners.push({
        key: 'bn-' + show.id,
        showName: show.name,
        emoji: show.emoji || '',
        epLabel: '第' + sea.season + '季 · ' + (ep.title || ('第' + ep.episodeNo + '期')),
        count: games.length,
        n: bnGames.length, // 游戏数量决定轮播卡布局（1/2/3/4 各有铺满方案）
        tone: i % 4,
        toneName: show.toneName || 'gold',
        games: bnGames
      })
    })

    this.setData({
      loading: false,
      shows: catalog.shows,
      banners: banners,
      bnIndex: 0,
      loadError: '',
      catGroups: this.groupGames(this.filterByCat(this.data.activeCat, flat))
    })
    this.startBannerTimer()
  },

  runUpdate: function () {
    // 全自动：无手动入口、无肉眼可见的状态条，失败也不打扰用户（下次打开再试）
    api.checkForUpdates(false).then((res) => {
      if (res && res.result === 'updated') this.refresh()
    }).catch(() => { /* 静默失败 */ })
  },

  filterByCat: function (cat, flat) {
    if (cat === '全部') return []
    return flat.filter((g) => (g.tags || []).indexOf(cat) >= 0)
  },

  /**
   * 同名游戏去重合并：
   * 相同名字的游戏合并为一张卡（可能是不同综艺/不同期的变体版本，
   * 规则相同但词库、名场面不同），展开可看每一个版本的出处。
   */
  groupGames: function (list) {
    const map = {}
    const order = []
    list.forEach((g) => {
      if (!map[g.name]) {
        map[g.name] = []
        order.push(g.name)
      }
      map[g.name].push(g)
    })
    return order.map((name) => {
      const variants = map[name]
      const first = variants[0]
      // 找出变体之间的差异点（词库/规则不同则标注）
      const scenes = variants.map((v) => v.scene).filter((s, i, a) => s && a.indexOf(s) === i)
      return {
        name: name,
        count: variants.length,
        style: first.style,
        scene: first.scene,
        min_players: first.min_players,
        max_players: first.max_players,
        addedLabel: first.addedLabel,
        tagsMeta: first.tagsMeta || [],
        open: false,
        variantCount: variants.length > 1 ? ('共' + variants.length + '个版本') : '',
        sceneCount: scenes.length > 1 ? (scenes.length + '种名场面') : '',
        variants: variants
      }
    })
  },

  onCat: function (e) {
    const v = e.currentTarget.dataset.v
    this.setData({
      activeCat: v,
      catGroups: this.groupGames(this.filterByCat(v, this.flatGames || [])),
      searchBanner: '',
      locatedGroups: [],
      query: ''
    })
    // 分类栏滑到右边时，"全部"按钮会看不见，这里把它划回第一个
    this.setData({ catInto: '' })
    setTimeout(() => this.setData({ catInto: 'cat-all' }), 30)
  },

  // 从分类/搜索结果一键回到默认的完整游戏列表
  resetAll: function () {
    this.setData({
      activeCat: '全部',
      catGroups: [],
      searchBanner: '',
      locatedGroups: [],
      query: ''
    })
    this.setData({ catInto: '' })
    setTimeout(() => this.setData({ catInto: 'cat-all' }), 30)
  },

  onQuery: function (e) { this.setData({ query: e.detail.value }) },

  quickSearch: function (e) {
    this.setData({ query: e.currentTarget.dataset.q }, () => this.onSearch())
  },

  onSearch: function () {
    const q = (this.data.query || '').trim()
    if (!q) return
    const flat = this.flatGames || []
    const shows = (this.catalog && this.catalog.shows) || []

    // 1. 找综艺名：精准定位到某一期
    let hitShow = null
    shows.forEach((s) => { if (q.indexOf(s.name) >= 0) hitShow = s })

    if (hitShow) {
      let sea = null
      let ep = null
      const seaMatch = q.match(/第\s*(\d+)\s*季/)
      const epMatch = q.match(/第\s*(\d+)\s*期/)
      const wantLatest = q.indexOf('最新') >= 0
      if (seaMatch) {
        sea = hitShow.seasons.filter((s) => s.season === parseInt(seaMatch[1], 10))[0]
      } else {
        sea = hitShow.seasons[0] // 季按从新到旧排
      }
      if (sea) {
        if (epMatch) {
          ep = sea.episodes.filter((e) => e.episodeNo === parseInt(epMatch[1], 10))[0]
        } else {
          // 期按从新到旧存，最新一期是第一条
          ep = sea.episodes[0]
        }
      }
      if (ep) {
        const decorated = ep.games.map((g) => {
          const found = flat.filter((f) => f.id === g.id)[0] || g
          return {
            id: g.id, name: g.name, tags: g.tags, style: g.play_style || '',
            scene: found.scene || g.scene || '',
            tagsMeta: found.tagsMeta || [],
            addedLabel: found.addedLabel || '',
            min_players: g.min_players, max_players: g.max_players,
            showName: hitShow.name, season: sea.season,
            episodeNo: ep.episodeNo, epTitle: ep.title
          }
        })
        this.setData({
          searchBanner: '已找到：' + hitShow.name + ' 第' + sea.season + ' 季 第' + ep.episodeNo + ' 期「' + ep.title + '」' + (ep.isLatest ? '（最新一期）' : ''),
          locatedGroups: this.groupGames(decorated),
          activeCat: '全部'
        })
        return
      }
    }

    // 2. 按游戏名找（去重合并后展示）
    const byName = flat.filter((g) => g.name.indexOf(q) >= 0)
    const byTag = CATEGORIES.filter((c) => c.value !== '全部' && q.indexOf(c.value) >= 0)
    let results = byName
    if (!results.length && byTag.length) results = this.filterByCat(byTag[0].value, flat)

    this.setData({
      searchBanner: results.length ? '找到 ' + this.groupGames(results).length + ' 个游戏（同名版本已合并）' : '没找到「' + q + '」，试试综艺名或游戏名',
      locatedGroups: this.groupGames(results),
      activeCat: '全部'
    })
  },

  // 点合并卡：只有一个版本直接进，多版本先展开看变体
  goGroup: function (e) {
    const name = e.currentTarget.dataset.name
    const groups = this.data.activeCat !== '全部' ? this.data.catGroups : this.data.locatedGroups
    const field = this.data.activeCat !== '全部' ? 'catGroups' : 'locatedGroups'
    const g = groups.filter((x) => x.name === name)[0]
    if (!g) return
    if (g.count === 1) {
      wx.navigateTo({ url: '/pages/game/game?id=' + g.variants[0].id })
      return
    }
    g.open = !g.open
    this.setData({ [field]: groups })
  },

  goVariant: function (e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/game/game?id=' + id })
  },

  toggleShow: function (e) {
    const id = e.currentTarget.dataset.id
    const shows = this.data.shows
    for (let i = 0; i < shows.length; i++) {
      if (shows[i].id === id) {
        shows[i].open = !shows[i].open
        break
      }
    }
    this.setData({ shows: shows })
  },

  goGame: function (e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/game/game?id=' + id })
  }
})
