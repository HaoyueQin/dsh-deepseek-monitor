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
  | 'composerChip'
  | 'composerChipDesc'
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
  composerChip: '输入框余额显示',
  composerChipDesc: '在输入框（模型名称左侧）显示 DeepSeek 官方账户余额，仅当使用内置官方供应商时出现。',
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

export const zhTW: Record<DeepSeekMonitorKey, string> = {
  balanceLabel: '餘額',
  usageBtn: '帳戶明細',
  balanceTitle: '帳戶餘額',
  refresh: '重新整理',
  refreshedAt: '更新於',
  grantedBalance: '贈送',
  copyScript: '② 複製擷取指令碼',
  scriptCopied: '已複製：到平台頁 F12 主控台貼上並按 Enter，於彈窗中複製 Token',
  toppedUpBalance: '儲值',
  keyNotConfigured: '未偵測到 API Key，請先在本頁 DeepSeek 卡片設定',
  tokenTitle: '平台用量 Token',
  tokenDesc: '用於讀取開放平台的按月用量與費用（與 API Key 不同）。取得方式二選一：① 點「開啟開放平台」登入後，點「複製擷取指令碼」，在平台頁按 F12 開啟主控台貼上並按 Enter，彈窗裡複製 Token；② 或在平台頁 F12 → Network → 篩選 Fetch/XHR → 重新整理頁面 → 點選任一 api/v0 請求，複製 Request Headers 裡 Authorization: Bearer 後的字串。',
  tokenPlaceholder: '貼上平台 token…',
  tokenSave: '儲存並驗證',
  tokenClear: '清除',
  tokenConfigured: '已設定',
  tokenNotSet: '未設定',
  saveOk: '已儲存，驗證通過',
  opFailed: '操作失敗',
  openPlatform: '① 開啟開放平台',
  monthUsage: '本月用量',
  colCacheHit: '快取命中',
  colCost: '費用',
  noTokenHint: '設定平台 Token 後即可檢視按月用量與費用。',
  noUsageData: '該月暫無用量資料',
  settingsTitle: '設定',
  autoRefresh: '自動重新整理',
  refreshInterval: '重新整理間隔',
  secondsUnit: '秒',
  lowBalanceAlert: '低餘額提醒',
  lowBalanceThreshold: '閾值',
  composerChip: '輸入框餘額顯示',
  composerChipDesc: '在輸入框（模型名稱左側）顯示 DeepSeek 官方帳戶餘額，僅在使用內建官方供應商時出現。',
  clearCache: '清除快取',
  reloadCache: '重載快取',
  cacheCleared: '快取已清除',
  reloaded: '已重新載入全部資料',
  lowBalanceWarn: '餘額低於閾值，請注意儲值',
  balanceAvailable: '可用',
  balanceInsufficient: '餘額不足',
  todayCost: '今日消耗',
  monthCostLabel: '本月費用',
  legendHit: '命中',
  legendMiss: '未命中',
  legendOutput: '輸出',
  refreshedBalance: '餘額已重新整理',
  tokenCleared: 'Token 已清除',
  saved: '已儲存',
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
  composerChip: 'Composer balance',
  composerChipDesc: 'Show the official DeepSeek account balance in the composer, left of the model name (only for the built-in official provider).',
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
