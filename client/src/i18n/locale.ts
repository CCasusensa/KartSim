import { nativeMenusTranslations, nativeKoreanOverrides } from "./catalogs/native-menus";
import { lobbyTranslations } from "./catalogs/lobby";
import { taskbarTranslations } from "./catalogs/taskbar";
import { resourcesSettingsTranslations } from "./catalogs/resources-settings";
import { menuTranslations } from "./catalogs/menus";
import { singlePlayerTranslations } from "./catalogs/single-player";
import { cityTranslations } from "./catalogs/city";
import { editorTranslations } from "./catalogs/editor";
import { accountTranslations } from "./catalogs/account";

export type GameLocale = "zh-CN" | "en" | "ko";

const STORAGE_KEY = "kartsim.language";
const LOCALES: readonly GameLocale[] = ["zh-CN", "en", "ko"];

function valid(value: string | null | undefined): value is GameLocale {
  return LOCALES.includes(value as GameLocale);
}

export function gameLocale(): GameLocale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (valid(saved)) return saved;
  } catch { /* Private browsing can disable storage. */ }
  return "zh-CN";
}

export function resourceLocale(): "cn" | "us" | "kr" {
  // The original game's StringBag uses `us`, not `en`, for English.
  return { "zh-CN": "cn", en: "us", ko: "kr" }[gameLocale()] as "cn" | "us" | "kr";
}

export function setGameLocale(locale: GameLocale): void {
  if (!valid(locale)) return;
  try { localStorage.setItem(STORAGE_KEY, locale); } catch { /* Keep this session usable. */ }
  document.documentElement.lang = locale;
}

const translations: Record<string, readonly [string, string]> = {
  ...accountTranslations,
  ...lobbyTranslations,
  ...taskbarTranslations,
  ...resourcesSettingsTranslations,
  ...nativeMenusTranslations,
  ...menuTranslations,
  ...editorTranslations,
  ...cityTranslations,
  ...singlePlayerTranslations,
  "语言": ["Language", "언어"], "中文": ["Chinese", "중국어"],
  "英文": ["English", "영어"], "韩文": ["Korean", "한국어"],
  "跑跑卡丁车 · 账号登录": ["KartRider · Sign in", "카트라이더 · 로그인"],
  "KartSim 开发版": ["KartSim Preview", "KartSim 개발 버전"],
  "KartSim 游戏画面": ["KartSim game", "KartSim 게임 화면"],
  "跑跑卡丁车 · 注册新账号": ["KartRider · Create account", "카트라이더 · 계정 만들기"],
  "账号名": ["Account name", "계정 이름"], "游戏昵称": ["Nickname", "게임 닉네임"],
  "密码": ["Password", "비밀번호"], "确认密码": ["Confirm password", "비밀번호 확인"],
  "邀请码": ["Invitation code", "초대 코드"],
  "有邀请码？": ["Have an invitation code?", "초대 코드가 있나요?"],
  "正在注册…": ["Creating account…", "계정 만드는 중…"],
  "正在登录…": ["Signing in…", "로그인 중…"],
  "两次输入的密码不一致。": ["Passwords do not match.", "비밀번호가 일치하지 않습니다."],
  "重试": ["Retry", "다시 시도"],
  "注册并登录": ["Create account and sign in", "가입하고 로그인"],
  "登录": ["Sign in", "로그인"],
  "已有账号，去登录": ["Already have an account? Sign in", "계정이 있나요? 로그인"],
  "用邀请码注册": ["Register with code", "초대 코드로 가입"],
  "注册新账号": ["Create account", "새 계정 만들기"],
  "账号名 3–24 位字母、数字或下划线；游戏昵称 1–16 字；密码至少 8 位。": [
    "Account: 3–24 letters, digits or underscores; nickname: 1–16 characters; password: at least 8 characters.",
    "계정 이름: 영문, 숫자, 밑줄 3–24자; 닉네임: 1–16자; 비밀번호: 최소 8자."],
  "主菜单": ["Main menu", "메인 메뉴"], "单人游戏": ["Single player", "싱글 플레이"],
  "自定义游戏": ["Custom games", "커스텀 게임"], "计时赛": ["Time attack", "타임어택"],
  "地图工坊": ["Map workshop", "맵 제작소"],
  "上一页": ["Previous page", "이전 페이지"], "下一页": ["Next page", "다음 페이지"],
  "活动": ["Events", "이벤트"], "跑跑通行证": ["Kart Pass", "카트 패스"],
  "驾照考试": ["License test", "라이선스 시험"],
  "故事模式": ["Story mode", "시나리오"], "车手学院": ["Rider school", "라이더 스쿨"],
  "回放": ["Replays", "리플레이"], "练习计时赛": ["Practice time attack", "연습 타임어택"],
  "排位计时赛": ["Ranked time attack", "랭킹 타임어택"],
  "竞争排位赛": ["Competitive ranked race", "경쟁 랭킹전"],
  "新手驾照": ["Beginner license", "초보 라이선스"],
  "初级驾照": ["Junior license", "루키 라이선스"],
  "L3驾照": ["L3 license", "L3 라이선스"], "L2驾照": ["L2 license", "L2 라이선스"],
  "L1驾照": ["L1 license", "L1 라이선스"], "PRO驾照": ["PRO license", "PRO 라이선스"],
  "基础驾驶技巧": ["Basic driving", "기초 주행 기술"],
  "高级驾驶技巧": ["Advanced driving", "고급 주행 기술"],
  "特殊驾驶技巧": ["Special driving", "특수 주행 기술"],
  "我的回放": ["My replays", "내 리플레이"],
  "联赛回放": ["League replays", "리그 리플레이"],
  "其他回放": ["Other replays", "다른 리플레이"],
  "其他回放　排位榜上其他车手的录像": ["Other replays · Ranked riders' recordings", "다른 리플레이 · 랭킹 기록"],
  "赛道": ["Track", "트랙"], "设置": ["Settings", "설정"],
  "赛道变更提示": ["Track changed", "트랙 변경 알림"],
  "选择赛道": ["Choose track", "트랙 선택"], "切换速度": ["Change speed", "속도 변경"],
  "切换模式": ["Change mode", "모드 변경"], "读取中…": ["Loading…", "불러오는 중…"],
  "车手": ["Rider", "라이더"], "日期 / 时间": ["Date / time", "날짜 / 시간"],
  "卡丁车": ["Kart", "카트"], "记录": ["Record", "기록"],
  "还没有回放记录。完成练习计时赛或排位计时赛后，这里会保存你的跑法。": [
    "No replays yet. Complete a practice or ranked time attack to save one here.",
    "리플레이가 없습니다. 연습 또는 랭킹 타임어택을 완료하면 여기에 저장됩니다."],
  "管理员还没有发布联赛回放。": ["No league replays have been published yet.", "아직 게시된 리그 리플레이가 없습니다."],
  "这个赛道和设置的排位榜上还没有带录像的纪录。": [
    "No ranked replay exists for this track and setup.", "이 트랙과 설정의 랭킹 리플레이가 없습니다."],
  "寻宝活动": ["Treasure hunt", "보물찾기 이벤트"], "精品道具": ["Featured items", "추천 아이템"],
  "兑换": ["Redeem", "교환"], "赠送": ["Gift", "선물"],
  "初始状态": ["Reset", "초기 상태"], "兑换预览道具": ["Redeem preview items", "미리보기 아이템 교환"],
  "推荐": ["Recommended", "추천"], "输入兑奖券": ["Enter coupon", "교환권 입력"],
  "充值": ["Top up", "충전"], "搜索": ["Search", "검색"],
  "请输入道具名称": ["Enter an item name", "아이템 이름을 입력하세요"],
  "道具价格": ["Item price", "아이템 가격"], "不可改装": ["Cannot be upgraded", "개조할 수 없음"],
  "新商品": ["New", "신상품"], "目前装备中": ["Equipped", "장착 중"],
  "角色": ["Character", "캐릭터"], "礼包": ["Bundle", "패키지"],
  "装备": ["Equip", "장착"], "使用": ["Use", "사용"],
  "全部": ["All", "전체"], "道具": ["Item", "아이템"],
  "竞速": ["Speed", "스피드"], "热门商品": ["Popular items", "인기 상품"],
  "气球": ["Balloon", "풍선"], "防尘眼镜": ["Goggles", "고글"],
  "染色剂": ["Dye", "염색약"], "宠物": ["Pet", "펫"],
  "飞行宠物": ["Flying pet", "플라잉 펫"], "炫光": ["Aura", "오라"],
  "漂移痕迹": ["Skid mark", "스키드 마크"], "车牌": ["License plate", "번호판"],
  "确定": ["OK", "확인"], "取消": ["Cancel", "취소"], "关闭": ["Close", "닫기"],
  "无限制": ["Unlimited", "무제한"], "道具名称": ["Item name", "아이템 이름"],
  "选择期限": ["Choose duration", "기간 선택"],
  "请选择要兑换道具的使用期限": ["Choose the duration of the item to redeem.", "교환할 아이템의 사용 기간을 선택하세요."],
  "获得徽章": ["Earn emblem", "엠블럼 획득"], "获得驾照": ["Get license", "라이선스 획득"],
  "正在加载游戏资源": ["Loading game resources", "게임 리소스 불러오는 중"],
  "当前下载：暂无": ["Current download: none", "현재 다운로드: 없음"],
  "当前下载：": ["Current download: ", "현재 다운로드: "],
  "首次进入需要下载游戏资源，请耐心等待": [
    "Game resources are downloaded on your first visit. Please wait.",
    "처음 접속하면 게임 리소스를 다운로드합니다. 잠시 기다려 주세요."],
};

/** Translate a known interface string, preserving unknown content and player text. */
export function tr(source: string, parameters?: Readonly<Record<string, string | number>>): string {
  const pair = translations[source];
  const locale = gameLocale();
  const text = locale === "en" ? pair?.[0] ?? source
    : locale === "ko" ? pair?.[1] ?? source : source;
  return parameters ? text.replace(/\{([^{}]+)\}/g, (placeholder, key: string) =>
    Object.hasOwn(parameters, key) ? String(parameters[key]) : placeholder) : text;
}

/** Resource bags contain interface copy, never player input. Empty locale rows fall back. */
export function resourceText<T>(entries: readonly T[], attribute: (entry: T, name: string) => string | null | undefined): string | undefined {
  if (gameLocale() === "ko") {
    const chinese = entries.find(entry => attribute(entry, "c") === "cn");
    const source = chinese && attribute(chinese, "v");
    // Regional resource rows occasionally describe different costs or rewards.
    if (source && nativeKoreanOverrides[source]) return nativeKoreanOverrides[source];
  }
  const preferred = gameLocale() === "en" ? ["us", "en"] : [resourceLocale()];
  for (const language of [...preferred, "cn", "us", "en", "kr", "tw", "zz"]) {
    const value = entries.find(entry => attribute(entry, "c") === language && attribute(entry, "v")?.trim());
    if (value) return tr(attribute(value, "v")!);
  }
  return undefined;
}

/** Keep the switch available on the loading and login screens as well as in game. */
export function installLanguagePicker(doc: Document = document): void {
  doc.documentElement.lang = gameLocale();
  doc.title = tr("KartSim 开发版");
  doc.querySelector("#app")?.setAttribute("aria-label", tr("KartSim 游戏画面"));
  if (doc.querySelector(".ks-language-picker")) return;
  const picker = doc.createElement("div");
  picker.className = "ks-language-picker";
  const label = doc.createElement("label");
  label.textContent = tr("语言");
  const select = doc.createElement("select");
  select.setAttribute("aria-label", tr("语言"));
  for (const [locale, name] of [["zh-CN", "中文"], ["en", "英文"], ["ko", "韩文"]] as const) {
    const option = doc.createElement("option");
    option.value = locale;
    option.textContent = tr(name);
    select.append(option);
  }
  select.value = gameLocale();
  select.addEventListener("change", () => {
    setGameLocale(select.value as GameLocale);
    doc.defaultView?.location.reload();
  });
  label.append(select);
  picker.append(label);
  const style = doc.createElement("style");
  style.textContent = `.ks-language-picker{position:fixed;top:max(52px,calc(env(safe-area-inset-top) + 52px));right:max(12px,env(safe-area-inset-right));z-index:2147483647;color:#fff;background:rgba(8,19,37,.88);border:1px solid rgba(255,255,255,.3);border-radius:8px;padding:5px 8px;font:13px/1.4 Arial,sans-serif;box-shadow:0 2px 8px #0006}.ks-language-picker label{display:flex;align-items:center;gap:7px}.ks-language-picker select{font:inherit;background:#fff;color:#172238;border:0;border-radius:4px;padding:3px 5px;max-width:130px}`;
  doc.head.append(style);
  doc.body.append(picker);
}
