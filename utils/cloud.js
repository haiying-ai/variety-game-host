const { createMiniProgramWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk/miniprogram')
const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics')

// 云端配置优先从 utils/cloud.local.js 读取（该文件已在 .gitignore 中，不会进仓库）
// 未配置时回退到示例值，接口调用会失败，但不会阻塞页面渲染
let localConfig = null
try {
  localConfig = require('./cloud.local')
} catch (e) {
  localConfig = null
}

const fallback = {
  endpoint: 'https://your-cloud-endpoint.example.com',
  publishableKey: 'YOUR_PUBLISHABLE_KEY',
}

const publicConfig = (localConfig && localConfig.publicConfig) || fallback

if (!publicConfig.publishableKey || publicConfig.publishableKey === 'YOUR_PUBLISHABLE_KEY') {
  console.warn('[cloud] 未检测到 utils/cloud.local.js，云端接口将不可用。请参考 utils/cloud.local.example.js 配置。')
}

const cloud = createMiniProgramWorkBuddyCloud({
  endpoint: publicConfig.endpoint,
  publishableKey: publicConfig.publishableKey,
  wx: createDiagnosticWx(wx),
})

module.exports = { cloud, publicConfig }
