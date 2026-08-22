/** Locale namespace id owned by the browser half. */
export const LOCALE_NS = 'deepseekMonitor'

/** The typed translator key union for this plugin's locale seat. */
export type DeepSeekMonitorKey =
  | 'balanceLabel'
  | 'usageBtn'
  | 'balanceTitle'
  | 'refresh'
  | 'refreshedAt'
  | 'grantedBalance'
  | 'toppedUpBalance'
  | 'keyNotConfigured'
  | 'tokenTitle'
  | 'tokenDesc'
  | 'tokenPlaceholder'
  | 'tokenSave'
  | 'tokenClear'
  | 'tokenConfigured'
  | 'tokenNotSet'
  | 'saveOk'
  | 'opFailed'
  | 'openPlatform'
  | 'monthUsage'
  | 'colCacheHit'
  | 'colCost'
  | 'noTokenHint'
  | 'noUsageData'
  | 'copyScript'
  | 'scriptCopied'
  | 'settingsTitle'
  | 'autoRefresh'
  | 'refreshInterval'
  | 'secondsUnit'
  | 'lowBalanceAlert'
  | 'lowBalanceThreshold'
  | 'clearCache'
  | 'reloadCache'
  | 'cacheCleared'
  | 'reloaded'
  | 'lowBalanceWarn'
  | 'balanceAvailable'
  | 'balanceInsufficient'
  | 'todayCost'
  | 'monthCostLabel'
  | 'legendHit'
  | 'legendMiss'
  | 'legendOutput'
  | 'refreshedBalance'
  | 'tokenCleared'
  | 'saved'

export const zh: Record<DeepSeekMonitorKey, string> = {
  balanceLabel: '余额',
  usageBtn: '账户明细',
  balanceTitle: '账户余额',
  refresh: '刷新',
  refreshedAt: '更新于',
  grantedBalance: '赠送',
  copyScript: '② 复制抓取脚本',
  scriptCopied: '已复制：到平台页 F12 控制台粘贴回车，弹窗中复制 Token',
  toppedUpBalance: '充值',
  keyNotConfigured: '未检测到 API Key，请先在本页 DeepSeek 卡片配置',
  tokenTitle: '平台用量 Token',
  tokenDesc: '用于读取开放平台的按月用量与费用（与 API Key 不同）。获取方式二选一：① 点「打开开放平台」登录后，点「复制抓取脚本」，在平台页按 F12 打开控制台粘贴回车，弹窗里复制 Token；② 或在平台页 F12 → Network → 筛选 Fetch/XHR → 刷新页面 → 点击任一 api/v0 请求，复制 Request Headers 里 Authorization: Bearer 后的字符串。',
  tokenPlaceholder: '粘贴平台 token…',
  tokenSave: '保存并验证',
  tokenClear: '清除',
  tokenConfigured: '已配置',
  tokenNotSet: '未配置',
  saveOk: '已保存，验证通过',
  opFailed: '操作失败',
  openPlatform: '① 打开开放平台',
  monthUsage: '本月用量',
  colCacheHit: '缓存命中',
  colCost: '费用',
  noTokenHint: '配置平台 Token 后即可查看按月用量与费用。',
  noUsageData: '该月暂无用量数据',
  settingsTitle: '设置',
  autoRefresh: '自动刷新',
  refreshInterval: '刷新间隔',
  secondsUnit: '秒',
  lowBalanceAlert: '低余额提醒',
  lowBalanceThreshold: '阈值',
  clearCache: '清除缓存',
  reloadCache: '重载缓存',
  cacheCleared: '缓存已清除',
  reloaded: '已重新加载全部数据',
  lowBalanceWarn: '余额低于阈值，请注意充值',
  balanceAvailable: '可用',
  balanceInsufficient: '余额不足',
  todayCost: '今日消耗',
  monthCostLabel: '本月费用',
  legendHit: '命中',
  legendMiss: '未命中',
  legendOutput: '输出',
  refreshedBalance: '余额已刷新',
  tokenCleared: 'Token 已清除',
  saved: '已保存',
}

export const en: Record<DeepSeekMonitorKey, string> = {
  balanceLabel: 'Balance',
  usageBtn: 'Account details',
  balanceTitle: 'Account balance',
  refresh: 'Refresh',
  refreshedAt: 'Updated',
  grantedBalance: 'Granted',
  toppedUpBalance: 'Topped-up',
  keyNotConfigured: 'No API Key detected — configure the DeepSeek card on this page first',
  tokenTitle: 'Platform usage token',
  tokenDesc: 'Reads monthly usage & cost from the open platform (NOT the API key). Two ways: ① click "Open platform", sign in, click "Copy capture script", paste it into the platform page console (F12) and hit Enter — copy the token from the popup; ② or on the platform page open DevTools → Network → filter Fetch/XHR → reload → click any api/v0 request and copy the string after "Authorization: Bearer".',
  tokenPlaceholder: 'Paste platform token…',
  tokenSave: 'Save & verify',
  tokenClear: 'Clear',
  tokenConfigured: 'configured',
  tokenNotSet: 'not set',
  saveOk: 'Saved and verified',
  opFailed: 'Operation failed',
  openPlatform: '① Open platform',
  copyScript: '② Copy capture script',
  scriptCopied: 'Copied. Paste into the platform page console (F12), press Enter, then copy from the popup.',
  monthUsage: 'Monthly usage',
  colCacheHit: 'Cache hit',
  colCost: 'Cost',
  noTokenHint: 'Configure the platform token to see monthly usage & cost.',
  noUsageData: 'No usage data for this month',
  settingsTitle: 'Settings',
  autoRefresh: 'Auto refresh',
  refreshInterval: 'Interval',
  secondsUnit: 's',
  lowBalanceAlert: 'Low-balance alert',
  lowBalanceThreshold: 'Threshold',
  clearCache: 'Clear cache',
  reloadCache: 'Reload cache',
  cacheCleared: 'Cache cleared',
  reloaded: 'All data reloaded',
  lowBalanceWarn: 'Balance is below the threshold — consider topping up',
  balanceAvailable: 'available',
  balanceInsufficient: 'insufficient',
  todayCost: "Today's cost",
  monthCostLabel: 'Month to date',
  legendHit: 'Hit',
  legendMiss: 'Miss',
  legendOutput: 'Output',
  refreshedBalance: 'Balance refreshed',
  tokenCleared: 'Token cleared',
  saved: 'Saved',
}
