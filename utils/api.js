const { cloud } = require('./cloud')

// 自动检查节流：距服务端上次成功同步不足 20 小时则跳过（服务端判断，与设备无关）
const AUTO_CHECK_INTERVAL = 20 * 60 * 60 * 1000
// 范围控制：每轮最多入库 2 期，剩余留给下一轮
const MAX_PER_RUN = 2

function getDeviceId() {
  let id = wx.getStorageSync('wb_device_id')
  if (!id) {
    id = 'dev_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e9).toString(36)
    wx.setStorageSync('wb_device_id', id)
  }
  return id
}

function unwrap(res, fallback) {
  if (res.error) throw res.error
  return res.data === undefined || res.data === null ? fallback : res.data
}

/** rpc 返回值解包：可能是数组包裹 / 字符串 / 对象 */
function rpcData(res) {
  let d = res.data
  if (Array.isArray(d)) d = d.length ? d[0] : null
  if (typeof d === 'string') {
    try { d = JSON.parse(d) } catch (e) { /* 保持原样 */ }
  }
  return d
}

/** 读取同步状态（data_version / last_sync_at / last_result） */
async function getSyncState() {
  const res = await cloud.database.from('sync_state')
    .select('data_version,last_sync_at,last_result,last_error')
    .eq('id', 'global')
    .maybeSingle()
  return (res && res.data) || {}
}

/**
 * 拉取完整目录：综艺 -> 季 -> 期 -> 游戏
 * 排序规则：期数按时间倒序（最新一期排最前），游戏也按新到旧
 */
async function fetchCatalog() {
  const [showsRes, episodesRes, gamesRes] = await Promise.all([
    cloud.database.from('shows').select('id,name,emoji,description').order('id'),
    cloud.database.from('episodes').select('id,show_id,season,episode_no,title')
      .order('season', { ascending: false }).order('episode_no', { ascending: false }),
    cloud.database.from('games')
      .select('id,episode_id,name,play_style,rules,tags,min_players,max_players,need_props,word_pool,scene,created_at')
      .order('id', { ascending: false })
  ])
  const shows = unwrap(showsRes, [])
  const episodes = unwrap(episodesRes, [])
  const games = unwrap(gamesRes, []).map(function (g) {
    // 兼容历史数据：把字面的 \n 字符转成真正的换行
    g.rules = String(g.rules || '').replace(/\\n/g, '\n')
    return g
  })

  const epById = {}
  episodes.forEach(function (ep) { epById[ep.id] = ep })

  const showList = shows.map(function (s) {
    const seasons = {}
    episodes.filter(function (ep) { return ep.show_id === s.id }).forEach(function (ep) {
      const epGames = games.filter(function (g) { return g.episode_id === ep.id })
      // 0 个游戏的期数不展示
      if (!epGames.length) return
      if (!seasons[ep.season]) seasons[ep.season] = []
      seasons[ep.season].push({
        id: ep.id,
        season: ep.season,
        episodeNo: ep.episode_no,
        title: ep.title,
        games: epGames
      })
    })
    const seasonKeys = Object.keys(seasons).map(Number).sort(function (a, b) { return b - a })
      .filter(function (k) { return seasons[k].length > 0 })
    return {
      id: s.id,
      name: s.name,
      emoji: s.emoji || '',
      description: s.description || '',
      seasons: seasonKeys.map(function (k) {
        return { season: k, episodes: seasons[k] }
      })
    }
  }).filter(function (s) { return s.seasons.length > 0 })

  return { shows: showList, games: games, fetchedAt: Date.now() }
}

/**
 * 带版本缓存的目录获取：
 * 服务端 data_version 没变时直接用本地缓存，避免每次全量拉三张表。
 * 数据涨到几百期后全量拉取会明显变慢，这是增量化的第一步。
 */
async function getCatalog() {
  const st = await getSyncState()
  const version = (st.data_version === undefined || st.data_version === null) ? null : Number(st.data_version)
  const cache = wx.getStorageSync('catalog_cache_v2')
  if (cache && cache.catalog && cache.catalog.shows && cache.catalog.shows.length
    && version !== null && cache.version === version) {
    cache.catalog.lastSyncAt = st.last_sync_at || ''
    return cache.catalog
  }
  const catalog = await fetchCatalog()
  catalog.lastSyncAt = st.last_sync_at || ''
  try {
    wx.setStorageSync('catalog_cache_v2', { version: version, catalog: catalog })
  } catch (e) { /* 缓存写失败不影响使用 */ }
  return catalog
}

/**
 * 单飞更新（v2：入库逻辑下沉数据库，客户端只做调度）：
 * 1. 自动检查时先用服务端 last_sync_at 节流（20 小时，与设备无关，重装/换机也生效）
 * 2. 抢同步锁（PostgreSQL 函数原子判断，同时只有一个用户能抢到）
 * 3. 查 remote_feed 未入库记录（每轮最多 2 条）
 * 4. 逐条调用数据库函数 ingest_feed_row 原子入库（一个 feed = 一个事务，幂等防重）
 *    单条失败调 mark_feed_failed 标记跳过——坏数据永远不会阻塞队列
 * 5. 调 release_sync 原子释放锁 + data_version 自增 + 结果留痕
 */
async function checkForUpdates(manual) {
  if (!manual) {
    const st = await getSyncState()
    const last = st.last_sync_at ? new Date(st.last_sync_at).getTime() : 0
    if (last && Date.now() - last < AUTO_CHECK_INTERVAL) {
      return { result: 'skipped', message: '' }
    }
  }

  const ownerId = getDeviceId()
  const claimRes = await cloud.database.rpc('try_claim_sync', { p_owner: ownerId })
  let claimed = claimRes.data
  if (Array.isArray(claimed)) claimed = claimed.length > 0 && claimed[0] !== null
  if (!claimed) {
    return { result: 'busy', message: '别的小朋友正在更新，先玩一会儿～' }
  }

  let newEpisodes = 0
  let newGames = 0
  let failedRows = 0
  let hasDataChange = false
  try {
    const feedRes = await cloud.database.from('remote_feed')
      .select('id,show_name,season,episode_no')
      .eq('ingested', false)
      .order('season', { ascending: false })
      .order('episode_no', { ascending: false })
      .limit(MAX_PER_RUN)
    const feedRows = unwrap(feedRes, [])

    if (!feedRows.length) {
      await releaseSync(ownerId, false, '无新内容', '')
      return { result: 'none', message: '已经是最新啦' }
    }

    for (let i = 0; i < feedRows.length; i++) {
      const row = feedRows[i]
      try {
        const res = await cloud.database.rpc('ingest_feed_row', { p_row_id: row.id })
        const info = rpcData(res) || {}
        if (info.status === 'ok') {
          newGames += info.games || 0
          if (info.episode_created) newEpisodes++
          if ((info.games || 0) > 0 || info.episode_created === true) hasDataChange = true
        } else if (info.status === 'already' || info.status === 'empty' || info.status === 'missing') {
          // 已处理过 / 空数据：该行已消化，不算失败
        } else {
          throw new Error('入库函数返回异常：' + JSON.stringify(info))
        }
      } catch (rowErr) {
        // 毒丸免疫：单条失败标记后继续，绝不阻塞后面的新期数
        failedRows++
        try {
          await cloud.database.rpc('mark_feed_failed', {
            p_row_id: row.id,
            p_error: String((rowErr && rowErr.message) || rowErr)
          })
        } catch (e2) { /* 标记失败也继续 */ }
      }
    }

    const parts = []
    if (newEpisodes) parts.push(newEpisodes + '期')
    if (newGames) parts.push(newGames + '个游戏')
    const summary = parts.length ? '新入库' + parts.join('、') : '无新增内容'
    await releaseSync(ownerId, hasDataChange, summary, failedRows ? (failedRows + '条入库失败已跳过') : '')

    if (parts.length) {
      return {
        result: 'updated',
        message: '更新完成！' + summary + (failedRows ? '，另有' + failedRows + '条失败已跳过' : ''),
        newEpisodes: newEpisodes,
        newGames: newGames
      }
    }
    if (failedRows) {
      return { result: 'partial_fail', message: '有' + failedRows + '条数据入库失败，已跳过，不影响现有内容' }
    }
    return { result: 'none', message: '已经是最新啦' }
  } catch (err) {
    try { await releaseSync(ownerId, false, '', String((err && err.message) || err)) } catch (e2) { /* 忽略 */ }
    throw err
  }
}

/** 原子释放锁 + 版本自增 + 结果留痕（数据库函数，一步完成） */
async function releaseSync(ownerId, bumped, result, error) {
  await cloud.database.rpc('release_sync', {
    p_owner: ownerId,
    p_bumped: !!bumped,
    p_result: result || '',
    p_error: error || ''
  })
}

module.exports = {
  fetchCatalog: fetchCatalog,
  getCatalog: getCatalog,
  checkForUpdates: checkForUpdates,
  getSyncState: getSyncState,
  getDeviceId: getDeviceId
}
