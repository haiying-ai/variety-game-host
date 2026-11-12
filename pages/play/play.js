const gen = require('../../utils/generator')
const gt = require('../../utils/gametype')
const wordgen = require('../../utils/wordgen')

Page({
  data: {
    // ===== 设置阶段 =====
    stage: 'setup',           // setup | play
    nameInputs: [],           // 玩家名单（主持人填写）
    playerCount: 6,
    gameName: '',
    rolePreview: '',
    goal: '',
    howto: '',

    // ===== 游戏阶段 =====
    mode: 'free',
    round: {},
    isGroup: false,
    revealed: false,
    cardCount: 0,
    wordIndex: 0,
    tdText: '',
    // 内容切换计数器：奇偶交替两个动画类，让每次换题都重播弹入
    tick: 0,
    scores: [],
    preparing: false,
    prepareError: '',

    // 主持人控制台
    players: [],              // [{name, secret, out}]
    secretSummary: [],        // 只有主持人能看的秘密信息
    steps: [],                // 阶段引导
    stepIndex: 0
  },

  onLoad: function (options) {
    const catalog = getApp().globalData.catalog || wx.getStorageSync('catalog_cache')
    const id = parseInt(options.id, 10)
    const players = parseInt(options.players, 10) || 6
    let game = null
    if (catalog) {
      catalog.shows.forEach((show) => {
        show.seasons.forEach((sea) => {
          sea.episodes.forEach((ep) => {
            ep.games.forEach((g) => { if (g.id === id) game = g })
          })
        })
      })
    }
    if (!game) {
      wx.showToast({ title: '游戏数据丢了', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1200)
      return
    }
    this.game = game
    this.profile = gt.resolveProfile(game)
    this.players = players
    if (options.show) {
      this.showName = decodeURIComponent(options.show)
    } else {
      this.showName = ''
    }

    const inputs = []
    for (let i = 0; i < players; i++) {
      inputs.push({ value: (i + 1) + '号' })
    }
    this.setData({
      playerCount: players,
      nameInputs: inputs,
      gameName: game.name,
      isGroup: gen.isGroupGame(game),
      goal: this.profile.goal,
      howto: this.profile.howto,
      rolePreview: this.buildPreview(this.profile, players)
    })
  },

  buildPreview: function (profile, n) {
    const k = profile.kind
    if (k === 'werewolf') {
      const wolves = Math.max(1, Math.floor(n / 4))
      return '自动发身份：狼人' + wolves + '名，其余是好人（含预言家等神职）'
    }
    if (k === 'pair') {
      return '自动发词：' + (n >= 9 ? '2 名卧底' : '1 名卧底') + (n >= 8 ? '，还有 1 个白板' : '')
    }
    if (k === 'case') return '自动生成一个案件，其中 1 人是凶手'
    if (k === 'boss') return '自动发身份：老板 1 名 + 杀手 1 名（随机暗号动作）'
    if (profile.needContent) return '每局由 AI 随机出「' + profile.label + '」，不会重复'
    return ''
  },

  // ===== 设置阶段 =====
  onNameInput: function (e) {
    const i = e.currentTarget.dataset.i
    const key = 'nameInputs[' + i + '].value'
    this.setData({ [key]: e.detail.value })
  },

  startGame: function () {
    const names = this.data.nameInputs.map((x, i) => {
      const v = (x.value || '').trim()
      return v || ((i + 1) + '号')
    })
    this.playerNames = names
    this.setData({
      stage: 'play',
      scores: this.buildScores(names)
    }, () => this.prepareRound())
  },

  buildScores: function (names) {
    if (gen.isGroupGame(this.game)) {
      return [{ name: '红队', score: 0 }, { name: '蓝队', score: 0 }]
    }
    return names.map((n) => ({ name: n, score: 0 }))
  },

  // ===== 生成一局：身份类当场发牌，内容类先向大模型要一组 =====
  prepareRound: function () {
    const profile = this.profile
    if (!profile.needContent) {
      this.finishRound({ item: null, source: 'local' })
      return
    }
    this.setData({ preparing: true, prepareError: '', tdText: '', revealed: false, wordIndex: 0 })
    wordgen.nextItem(this.game, profile, this.showName).then((res) => {
      this.finishRound(res || { item: null, source: 'local' })
    }).catch(() => {
      this.finishRound({ item: null, source: 'local' })
    })
  },

  finishRound: function (res) {
    const round = gen.buildRound(this.game, this.profile, {
      playerCount: this.playerNames.length,
      names: this.playerNames,
      item: res.item,
      source: res.source
    })
    this.setData({
      preparing: false,
      prepareError: res.item ? '' : (this.profile.needContent ? '网络不太好，先用本地题库出了一题' : ''),
      mode: round.mode,
      round: round,
      revealed: false,
      wordIndex: 0,
      tdText: '',
      stepIndex: 0,
      tick: (this.data.tick || 0) + 1
    })
    if (round.mode === 'cards') this.applyIdentityRound(round, this.profile.kind)
  },

  // 身份类：把身份分给玩家，并生成主持人可见的秘密信息和阶段引导
  applyIdentityRound: function (round, kind) {
    const players = this.playerNames.map((name, i) => ({
      name: name,
      secret: round.cards[i].secret,
      tip: round.cards[i].tip,
      out: false
    }))
    let summary = []
    let steps = []

    if (kind === 'boss') {
      const bossP = players.filter((p) => p.secret === '老板')
      const killerP = players.filter((p) => p.secret === '杀手')
      const signal = round.signal || ''
      summary.push('老板：' + (bossP.map((p) => p.name).join('、') || '无'))
      summary.push('杀手：' + (killerP.map((p) => p.name).join('、') || '无'))
      summary.push('暗号动作：' + signal)
      summary.push('好人：' + players.filter((p) => p.secret === '好人').map((p) => p.name).join('、'))
      steps.push('发身份：让每个人偷偷看自己的身份（别让别人看到）')
      steps.push('天黑：老板（' + (bossP.map((p) => p.name).join('、') || '—') + '）悄悄指定一名要干掉的人')
      steps.push('白天：杀手（' + (killerP.map((p) => p.name).join('、') || '—') + '）找机会和老板对上暗号「' + signal + '」，再动手')
      steps.push('投票：好人观察谁在对暗号，点上面的玩家标记出局')
      steps.push('揭晓：公布老板和杀手，杀手完成任务算杀手方赢')
    } else if (kind === 'werewolf') {
      const wolves = players.filter((p) => p.secret === '狼人').map((p) => p.name)
      const seer = players.filter((p) => p.secret === '预言家').map((p) => p.name)
      const witch = players.filter((p) => p.secret === '女巫').map((p) => p.name)
      const hunter = players.filter((p) => p.secret === '猎人').map((p) => p.name)
      summary.push('狼人（' + wolves.length + '名）：' + wolves.join('、'))
      if (seer.length) summary.push('预言家：' + seer.join('、'))
      if (witch.length) summary.push('女巫：' + witch.join('、'))
      if (hunter.length) summary.push('猎人：' + hunter.join('、'))
      summary.push('平民：' + players.filter((p) => p.secret === '平民').map((p) => p.name).join('、'))
      steps.push('天黑了：宣布"天黑请闭眼"，所有人闭眼')
      steps.push('狼人睁眼：让狼人（' + wolves.join('、') + '）睁眼，商量今晚要吃谁')
      if (seer.length) steps.push('预言家睁眼：预言家（' + seer.join('、') + '）指定一个人，你用手势告诉他是好人还是狼人')
      if (witch.length) steps.push('女巫睁眼：女巫（' + witch.join('、') + '）决定今晚救不救、毒不毒')
      if (hunter.length) steps.push('猎人：猎人（' + hunter.join('、') + '）出局时可以带走一个人')
      steps.push('天亮了：宣布昨晚谁出局，出局的人亮出身份')
      steps.push('轮流发言：从 1 号开始，每人说说自己怀疑谁')
      steps.push('投票放逐：大家举手投票，点上面的玩家可以标记出局')
    } else if (kind === 'pair') {
      const parts = (round.wordPair || '/').split(' / ')
      const civ = parts[0] || ''
      const spy = parts[1] || ''
      const spies = players.filter((p) => p.secret === spy).map((p) => p.name)
      const blanks = players.filter((p) => p.secret === '白板').map((p) => p.name)
      summary.push('平民词：' + civ)
      summary.push('卧底词：' + spy + '（卧底：' + (spies.join('、') || '无') + '）')
      if (blanks.length) summary.push('白板：' + blanks.join('、'))
      steps.push('发词：让每个人偷偷看自己的词，别给别人看到')
      steps.push('轮流描述：从 1 号开始，每人用一句话形容自己的词，不能直接说出来')
      steps.push('投票：讨论后投票淘汰一人，点上面的玩家标记出局')
      steps.push('重复描述和投票，直到找出所有卧底')
      steps.push('揭晓：公布平民词「' + civ + '」和卧底词「' + spy + '」')
    } else if (kind === 'case') {
      const culprit = players.filter((p) => p.tip.indexOf('凶手') >= 0).map((p) => p.name)
      summary.push('案件：' + (round.headline || ''))
      summary.push('凶手（只有主持人知道）：' + (culprit.join('、') || '无'))
      if (round.caseHint) summary.push('真相提示：' + round.caseHint)
      steps.push('宣读案件：' + (round.headline || ''))
      steps.push('发角色：让每个人看自己的角色，凶手可以说谎')
      steps.push('说不在场证明：每人一句话，说说案发时自己在干什么')
      steps.push('投票指认：讨论后投票，点上面的玩家标记出局')
      steps.push('揭晓：公布凶手是谁，找对了好人赢')
    }

    this.setData({
      players: players,
      secretSummary: summary,
      steps: steps,
      cardCount: players.length
    })
  },

  // ===== 主持人操作 =====
  toggleOut: function (e) {
    const i = e.currentTarget.dataset.i
    const key = 'players[' + i + '].out'
    this.setData({ [key]: !this.data.players[i].out })
  },

  prevStep: function () {
    if (this.data.stepIndex > 0) {
      this.setData({ stepIndex: this.data.stepIndex - 1 })
    }
  },

  nextStep: function () {
    if (this.data.stepIndex < this.data.steps.length - 1) {
      this.setData({ stepIndex: this.data.stepIndex + 1 })
    } else {
      wx.showToast({ title: '本轮流程走完啦', icon: 'none' })
    }
  },

  nextRound: function () { this.prepareRound() },
  reshuffle: function () { this.prepareRound() },

  revealCard: function () { this.setData({ revealed: true }) },

  prevWord: function () {
    if (this.data.wordIndex > 0) {
      this.setData({ wordIndex: this.data.wordIndex - 1, tick: (this.data.tick || 0) + 1 })
    }
  },

  nextWord: function () {
    const round = this.data.round
    if (this.data.wordIndex < round.words.length - 1) {
      this.setData({ wordIndex: this.data.wordIndex + 1, tick: (this.data.tick || 0) + 1 })
    } else {
      wx.showToast({ title: '本轮的词都翻完啦', icon: 'none' })
    }
  },

  drawTruth: function () {
    const t = this.data.round.truths || []
    if (!t.length) return
    this.setData({ tdText: t[Math.floor(Math.random() * t.length)], tick: (this.data.tick || 0) + 1 })
  },

  drawDare: function () {
    const d = this.data.round.dares || []
    if (!d.length) return
    this.setData({ tdText: d[Math.floor(Math.random() * d.length)], tick: (this.data.tick || 0) + 1 })
  },

  changeScore: function (e) {
    const i = e.currentTarget.dataset.i
    const d = parseInt(e.currentTarget.dataset.d, 10)
    const scores = this.data.scores
    scores[i].score = Math.max(0, scores[i].score + d)
    this.setData({ scores: scores })
  },

  goBack: function () { wx.navigateBack() }
})
