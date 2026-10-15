import { gameLocale, type GameLocale } from "../i18n/locale";

/** Legacy rewards contain names and durations, not inventory/progress identifiers. */
const prizeNames: Readonly<Record<string, readonly [string, string, string?]>> = {
  "빌리지 테마 번호판": ["Village License Plate", "빌리지 테마 번호판", "城镇主题车牌"],
  "디지니 하트풍선": ["Dizni Heart Balloon", "디지니 하트풍선", "黑妞爱心气球"],
  "핫도그 핸드봉": ["Hot Dog Hand Stick", "핫도그 핸드봉", "热狗手杖"],
  "볼트 풍선": ["Bolt Balloon", "볼트 풍선", "螺栓气球"],
  "트랙 마스터 풍선": ["Track Master Balloon", "트랙 마스터 풍선", "赛道大师气球"],
  "루시드 데저트": ["Lucid Desert", "루시드 데저트", "露希德沙漠"],
  "아이스테마 번호판": ["Ice License Plate", "아이스 테마 번호판", "冰雪主题车牌"],
  "경광등 전자파 밴드": ["Beacon Electromagnetic Band", "경광등 전자파 밴드", "警灯电磁头饰"],
  "넘버원 핸드봉": ["Number One Hand Stick", "넘버원 핸드봉", "第一名手杖"],
  "皮蛋气球": ["Dao Balloon", "다오 풍선"],
  "黑妞气球": ["Dizni Balloon", "디지니 풍선"],
  "蓝色喷漆": ["Blue Paint", "파란색 페인트"],
  "胖墩气球": ["Kephi Balloon", "케피 풍선"],
  "防尘眼镜 B款式": ["Type B Goggles", "B형 고글"],
  "双倍经验卡": ["Double XP Card", "경험치 2배 카드"],
  "扳手头饰": ["Wrench Headgear", "렌치 머리장식"],
  "双倍金币卡": ["Double Lucci Card", "루찌 2배 카드"],
  "圣诞企鹅": ["Christmas Penguin", "크리스마스 펭귄"],
  "道具换位卡": ["Item Slot Swap Card", "아이템 슬롯 변경 카드"],
  "道具变更卡": ["Item Change Card", "아이템 변경 카드"],
  "黄金指南针气球": ["Golden Compass Balloon", "황금 나침반 풍선"],
  "黄金剑": ["Golden Sword", "황금 검"],
  "波利斯气球": ["Boris Balloon", "보리스 풍선"],
  "鬼泣车牌": ["Ghost Cry License Plate", "유령의 울음 번호판"],
  "人物属性卡": ["Character Attribute Card", "캐릭터 속성 카드"],
  "祭祀长头饰": ["High Priest Headgear", "대사제 머리장식"],
  "黄金剑头饰": ["Golden Sword Headgear", "황금 검 머리장식"],
  "波诺气球": ["Bono Balloon", "보노 풍선"],
  "迷你黄金石像": ["Mini Golden Statue", "미니 황금 석상"],
  "祭祀长面具": ["High Priest Mask", "대사제 가면"],
};

/** Name lookup stays separate from the unchanged reward values read by the parser. */
export function storyPrizeText(source: string, translateItemName: (source: string) => string,
  locale: GameLocale = gameLocale()): string {
  if (locale === "zh-CN" && !/\p{Script=Hangul}/u.test(source)) return source;
  const currency = /^(RP|经验|金币|루찌)\s*(\d+)$/u.exec(source.trim());
  if (currency) {
    const experience = currency[1] === "RP" || currency[1] === "经验";
    return locale === "zh-CN" ? `${experience ? "经验" : "金币"} ${currency[2]}`
      : locale === "en" ? `${currency[2]} ${experience ? "XP" : "Lucci"}`
      : `${experience ? "RP" : "루찌"} ${currency[2]}`;
  }
  const reward = /^(.*?)\s*\((\d+)\s*(天|个|일|개)\)$/u.exec(source.trim());
  if (!reward) return translateItemName(source);
  const originalName = reward[1]!.trim();
  const entry = prizeNames[originalName];
  const canonical = entry?.[2] ?? originalName;
  const translatedName = translateItemName(canonical);
  const name = translatedName !== canonical ? translatedName
    : entry?.[locale === "en" ? 0 : locale === "ko" ? 1 : 2] ?? canonical;
  const days = reward[3] === "天" || reward[3] === "일";
  const quantity = reward[2];
  const unit = locale === "zh-CN" ? days ? "天" : "个"
    : locale === "ko" ? days ? "일" : "개" : days ? " days" : "";
  return `${name} (${quantity}${unit})`;
}
