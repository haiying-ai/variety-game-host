/**
 * 大模型出题通道（走 WorkBuddy 云服务的 /.cloud/llm 代理，免密钥）
 *
 * 接口只支持流式（stream 必须为 true），这里用 wx.request 的 enableChunked
 * 逐块接收 SSE，兼容不支持分块的环境（退化成整包解析）。
 * 出题失败不抛错给页面，由调用方走本地词库兜底。
 */

const { publicConfig } = require('./cloud')

const ENDPOINT = publicConfig.endpoint + '/.cloud/llm/chat/completions'
// 便宜、快、中文口语好；失败再退到 fast-model
const MODELS = ['glm-5.3-flash', 'fast-model']

function decodeUtf8(buffer) {
  const bytes = new Uint8Array(buffer)
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i++]
    if (b < 0x80) {
      out += String.fromCharCode(b)
    } else if (b < 0xE0) {
      out += String.fromCharCode(((b & 0x1F) << 6) | (bytes[i++] & 0x3F))
    } else if (b < 0xF0) {
      out += String.fromCharCode(((b & 0x0F) << 12) | ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F))
    } else {
      const cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3F) << 12) | ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F)
      const v = cp - 0x10000
      out += String.fromCharCode(0xD800 + (v >> 10), 0xDC00 + (v & 0x3FF))
    }
  }
  return out
}

function parseSseBlock(block, append) {
  const lines = block.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.indexOf('data:') !== 0) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      const json = JSON.parse(payload)
      const choice = json.choices && json.choices[0]
      const delta = choice && (choice.delta || choice.message)
      if (delta && delta.content) append(delta.content)
    } catch (e) { /* 半截数据，忽略 */ }
  }
}

/** 调一次流式补全，返回完整文本 */
function chat(systemPrompt, userPrompt, options) {
  const opts = options || {}
  const timeout = opts.timeout || 25000
  const model = opts.model || MODELS[0]

  return new Promise(function (resolve, reject) {
    let text = ''
    let buffer = ''
    let settled = false
    let gotChunk = false
    let timer = null
    let task = null

    function append(s) { text += s }
    function consume(raw) {
      buffer += raw
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop()
      for (let i = 0; i < blocks.length; i++) parseSseBlock(blocks[i], append)
    }
    function done(err) {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (err) reject(err)
      else resolve(text)
    }

    try {
      task = wx.request({
        url: ENDPOINT,
        method: 'POST',
        timeout: timeout,
        enableChunked: true,
        responseType: 'text',
        header: {
          'Content-Type': 'application/json',
          'x-wb-webapp-access-key': publicConfig.publishableKey
        },
        data: {
          model: model,
          stream: true,
          temperature: opts.temperature === undefined ? 1.0 : opts.temperature,
          max_tokens: opts.maxTokens || 900,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        },
        success: function (res) {
          // 兼容不分块的环境：整包里就是完整 SSE 文本
          if (!gotChunk && typeof res.data === 'string' && res.data.indexOf('data:') >= 0) {
            parseSseBlock(res.data.split('\n\n').join('\n\n'), append)
          }
          if (res.statusCode && res.statusCode >= 400 && !text) {
            done(new Error('HTTP ' + res.statusCode))
            return
          }
          done(null)
        },
        fail: function (err) { done(new Error((err && err.errMsg) || 'request fail')) }
      })
    } catch (e) {
      done(e)
      return
    }

    if (task && typeof task.onChunkReceived === 'function') {
      task.onChunkReceived(function (res) {
        gotChunk = true
        try {
          consume(decodeUtf8(res.data))
        } catch (e) { /* 忽略解码异常 */ }
      })
    }

    timer = setTimeout(function () {
      if (task && typeof task.abort === 'function') task.abort()
      done(new Error('timeout'))
    }, timeout + 1000)
  })
}

/** 从模型输出里抠出 JSON 数组（容忍 ```json 包裹、前后废话） */
function extractArray(text) {
  if (!text) return null
  let s = String(text).replace(/```json/gi, '```').replace(/```/g, '')
  const start = s.indexOf('[')
  const end = s.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    const arr = JSON.parse(s.slice(start, end + 1))
    return Array.isArray(arr) && arr.length ? arr : null
  } catch (e) {
    return null
  }
}

/**
 * 让模型出一组题，返回数组；全部模型都失败时返回 null
 * validate(item) 用来过滤不合格的条目
 */
function generateArray(systemPrompt, userPrompt, validate) {
  let chain = Promise.resolve(null)
  MODELS.forEach(function (model, idx) {
    chain = chain.then(function (prev) {
      if (prev && prev.length) return prev
      return chat(systemPrompt, userPrompt, { model: model }).then(function (text) {
        const arr = extractArray(text)
        if (!arr) return null
        const clean = validate ? arr.filter(validate) : arr
        return clean.length ? clean : null
      }).catch(function () { return null })
    })
  })
  return chain
}

module.exports = {
  chat: chat,
  generateArray: generateArray,
  extractArray: extractArray
}
