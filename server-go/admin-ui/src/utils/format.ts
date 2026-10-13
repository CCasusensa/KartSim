// Display helpers: numbers with thousands separators, "—" for missing
// values, and Chinese labels of the API's enum values.

const numbers = new Intl.NumberFormat('zh-CN')

/** 1,234,567; "—" for null/undefined/''. */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return numbers.format(value)
}

const heap = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** A heap size in MB with one decimal ("0.6 MB"); "—" when missing. */
export function formatHeap(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${heap.format(value)} MB`
}

/** +1,234 / -1,234. */
export function formatSigned(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return (value > 0 ? '+' : '') + numbers.format(value)
}

/** The value, or "—" when empty. */
export function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

export const currencyNames: Record<string, string> = { coupon: '点券', lucci: '金币', koin: 'K币', exp: '经验' }

export function currencyName(currency: string | null | undefined): string {
  return currency ? currencyNames[currency] ?? currency : '—'
}

export type TagType = 'primary' | 'success' | 'info' | 'warning' | 'danger'

export const currencyTags: Record<string, TagType> = { coupon: 'warning', lucci: 'success', koin: 'primary', exp: 'info' }

export const currencyOptions = [
  { value: 'coupon', label: '点券' },
  { value: 'lucci', label: '金币' },
  { value: 'koin', label: 'K币' },
  { value: 'exp', label: '经验' },
]

/** Ledger reasons (wallet_ledger.reason / exp_ledger.reason). */
export const reasonNames: Record<string, string> = {
  starter: '新手礼包',
  race: '比赛奖励',
  racebonus: '比赛赠送',
  shopclaim: '商城领取',
  levelup: '升级奖励',
  timeattack: '计时赛奖励',
  purchase: '商城购买',
  admin: '管理员发放',
  lottery: '抽奖',
  lotterydaily: '每日免费道具',
  clubcreate: '创建俱乐部',
  clubdonate: '俱乐部捐助',
  clubwelfare: '俱乐部福利',
  dictionary: '道具图鉴',
  expedition: '赛车探险队',
  license: '驾照考试',
  rewardbox: '奖励箱',
  cityfuel: '卡丁城加油',
  cityrescue: '道路救援',
}

export function reasonName(reason: string | null | undefined): string {
  return reason ? reasonNames[reason] ?? reason : '—'
}

export const reasonOptions = Object.entries(reasonNames).map(([value, label]) => ({ value, label: `${label}（${value}）` }))

/** Inventory sources. */
const sourceNames: Record<string, string> = {
  starter: '新手礼包',
  shop: '商城',
  pack: '礼包',
  daily: '每日免费',
  lottery: '抽奖/开箱',
  license: '驾照考试',
  expedition: '赛车探险队',
  rewardbox: '奖励箱',
  admin: '管理员',
  quest: '任务',
  club: '俱乐部',
}

export function sourceName(source: string | null | undefined): string {
  return source ? sourceNames[source] ?? source : '—'
}

export const gameplayNames: Record<string, string> = {
  ordinary: '竞速',
  grip: '抓地',
  shadow: '幽灵',
  roadblock: '挡人',
  lte: 'LTE',
  giant: '巨人',
  rp: 'RP',
  item: '道具',
  brawl: '50人乱斗',
}

export function gameplayName(gameplay: string | null | undefined): string {
  return gameplay ? gameplayNames[gameplay] ?? gameplay : '—'
}

export const gameplayOptions = Object.entries(gameplayNames).map(([value, label]) => ({ value, label }))

export const loginKindNames: Record<string, string> = { login: '登录', register: '注册', resume: '自动登录' }

export function loginKindName(kind: string | null | undefined): string {
  return kind ? loginKindNames[kind] ?? kind : '—'
}

export const loginKindOptions = Object.entries(loginKindNames).map(([value, label]) => ({ value, label }))

const loginKindTags: Record<string, TagType> = { register: 'success', login: 'info', resume: 'primary' }

export function loginKindTag(kind: string | null | undefined): TagType {
  return (kind && loginKindTags[kind]) || 'info'
}

/** The anti-cheat checks (ANTICHEAT.md 2). */
export const antiCheatChecks: Record<string, string> = {
  TELEPORT: '坐标瞬移',
  SPEED: '移动速度异常',
  CLOCK: '时钟加速',
  PROGRESS: '赛道进度异常',
  LAP: '圈数异常',
  FINISH_TIME: '完赛时间异常',
  FINISH_EARLY: '未跑完就完赛',
  FINISH_FAST: '完赛过快',
  CUBE_RATE: '道具箱拾取过快',
  BAD_FRAME: '运动帧格式无效',
}

export function antiCheatCheck(code: string | null | undefined): string {
  return (code && antiCheatChecks[code]) || text(code)
}

export const antiCheatCheckOptions = Object.entries(antiCheatChecks).map(([value, label]) => ({ value, label }))

export const antiCheatActions: Record<string, { label: string; type: TagType }> = {
  kick: { label: '已踢出', type: 'danger' },
  log: { label: '仅记录', type: 'warning' },
}

export const antiCheatActionOptions = Object.entries(antiCheatActions).map(([value, { label }]) => ({ value, label }))

export function antiCheatAction(action: string | null | undefined): { label: string; type: TagType } {
  return (action && antiCheatActions[action]) || { label: text(action), type: 'info' }
}

export const drawKindNames: Record<string, string> = { treasure: '寻宝', gacha: '精品道具场' }

export function drawKindName(kind: string | null | undefined): string {
  return kind ? drawKindNames[kind] ?? kind : '—'
}

const clubGrades: Record<string, string> = { '1': '会长', '2': '管理层', '3': '优秀会员', '4': '会员' }

export function clubGradeName(grade: number | string | null | undefined): string {
  if (grade === null || grade === undefined || grade === '') return '—'
  return clubGrades[String(grade)] ?? String(grade)
}

/** ClubRow.state. */
export const clubStates: Record<string, { label: string; type: TagType }> = {
  active: { label: '正常', type: 'success' },
  breaking: { label: '解散中', type: 'warning' },
  disbanded: { label: '已解散', type: 'danger' },
}

export const clubStateOptions = Object.entries(clubStates).map(([value, { label }]) => ({ value, label }))

export function clubState(state: string | null | undefined): { label: string; type: TagType } {
  return (state && clubStates[state]) || { label: state || '—', type: 'info' }
}

/** License levels (驾照: baseStringBag licenseLevel1..6); 0 is none. */
const licenseLevels: Record<string, string> = { '0': '无', '1': '新手', '2': '初级', '3': 'L3', '4': 'L2', '5': 'L1', '6': 'PRO' }

export function licenseLevelName(level: number | null | undefined): string {
  if (level === null || level === undefined) return '—'
  return licenseLevels[String(level)] ?? `等级 ${level}`
}

/** Reward box sources (rewardMajorType). */
export const rewardBoxSources: Record<string, { label: string; type: TagType }> = {
  quest: { label: '任务', type: 'primary' },
  club: { label: '俱乐部', type: 'success' },
  admin: { label: '管理员', type: 'warning' },
}

export const rewardBoxSourceOptions = Object.entries(rewardBoxSources).map(([value, { label }]) => ({ value, label }))

export function rewardBoxSource(source: string | null | undefined): { label: string; type: TagType } {
  return (source && rewardBoxSources[source]) || { label: source || '—', type: 'info' }
}

/** RewardBoxRow.state. */
export const rewardBoxStates: Record<string, { label: string; type: TagType }> = {
  unclaimed: { label: '未领取', type: 'warning' },
  claimed: { label: '已领取', type: 'success' },
  expired: { label: '已过期', type: 'info' },
}

export const rewardBoxStateOptions = Object.entries(rewardBoxStates).map(([value, { label }]) => ({ value, label }))

export function rewardBoxState(state: string | null | undefined): { label: string; type: TagType } {
  return (state && rewardBoxStates[state]) || { label: state || '—', type: 'info' }
}

/** MapRow.hidden as a state (the list's state filter: public, hidden). */
export const mapStates: Record<string, { label: string; type: TagType }> = {
  public: { label: '公开', type: 'success' },
  hidden: { label: '已隐藏', type: 'info' },
}

export const mapStateOptions = Object.entries(mapStates).map(([value, { label }]) => ({ value, label }))

export function mapState(hidden: boolean): { label: string; type: TagType } {
  return mapStates[hidden ? 'hidden' : 'public']!
}

/** Map themes, as the map editor names them (client/src/mapeditor/source-tracks.ts THEME_TITLES). */
const themeNames: Record<string, string> = {
  village: '城镇', forest: '森林', desert: '沙漠', ice: '冰河', tomb: '墓地', mine: '矿山',
  northeu: '北欧', factory: '工厂', pirate: '海盗', fairy: '童话', moonhill: '月光',
  gold: '黄金文明', china: '中国', castle: '城堡', nymph: '妖精', mechanic: '机械',
  xyy: '喜羊羊', wkc: '世界赛', brodi: '布罗迪', park: '公园', beach: '海滨',
  transFormer: '变形金刚', jurassic: '侏罗纪', world: '世界', nemo: '尼莫',
  sword: '剑', god: '神殿', abyss: '深渊', camelot: '卡美洛', olympos: '奥林匹斯',
  korea: '韩国', mabi: '洛奇', maple: '冒险岛', fengshen: '封神', steam: '蒸汽',
}

/** A theme's Chinese name; the id itself when unknown. */
export function themeName(theme: string | null | undefined): string {
  return theme ? themeNames[theme] ?? theme : '—'
}

/** 1–5 stars, as the game shows a track's difficulty. */
export function difficultyStars(level: number | null | undefined): string {
  const stars = Math.max(0, Math.min(5, Math.round(level ?? 0)))
  return stars ? '★'.repeat(stars) + '☆'.repeat(5 - stars) : '—'
}

/** 812 KB / 3.4 MB. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—'
  if (bytes < 1024 * 1024) return `${numbers.format(Math.ceil(bytes / 1024))} KB`
  return `${heap.format(bytes / (1024 * 1024))} MB`
}

/** A short "Chrome 140 · Windows" from a user agent ("—" when empty). */
export function userAgentSummary(ua: string | null | undefined): string {
  if (!ua) return '—'
  const browsers: [RegExp, string][] = [
    [/MicroMessenger\/([\d.]+)/, '微信'],
    [/Edg(?:e|A|iOS)?\/(\d+)/, 'Edge'],
    [/OPR\/(\d+)/, 'Opera'],
    [/Firefox\/(\d+)/, 'Firefox'],
    [/FxiOS\/(\d+)/, 'Firefox'],
    [/CriOS\/(\d+)/, 'Chrome'],
    [/Chrome\/(\d+)/, 'Chrome'],
    [/Version\/(\d+)[\d.]* .*Safari\//, 'Safari'],
  ]
  let browser = ''
  for (const [pattern, name] of browsers) {
    const match = pattern.exec(ua)
    if (match) {
      browser = name === '微信' ? name : `${name} ${match[1]}`
      break
    }
  }
  let os = ''
  if (/Windows/.test(ua)) os = 'Windows'
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS'
  else if (/Android/.test(ua)) os = 'Android'
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS'
  else if (/CrOS/.test(ua)) os = 'ChromeOS'
  else if (/Linux/.test(ua)) os = 'Linux'
  const summary = [browser, os].filter(Boolean).join(' · ')
  return summary || ua.slice(0, 40)
}

/** A display name "昵称（账号）", falling back to whichever exists. */
export function accountLabel(nickname: string | null | undefined, username: string | null | undefined): string {
  if (nickname && username) return `${nickname}（${username}）`
  return nickname || username || '—'
}
