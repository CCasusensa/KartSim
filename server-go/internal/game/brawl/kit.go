package brawl

import "math/rand/v2"

// What the AI racers race with (BRAWL.md 3): the starter practice kart in
// one of the starter paints, one of the eight classic riders in one of the
// starter dyes, so the browsers need nothing a new rider would not have
// downloaded already except those riders.
const (
	// KartKey is the starter system kart (economy catalog starter.kart).
	KartKey = "practiceKart"
)

var (
	characters = []int{1, 2, 3, 4, 5, 6, 7, 8} // 宝宝 皮蛋 黑妞 葱头 胖墩 蓝蓝 小强 小乖
	paints     = []int{4, 5, 6, 7}
	dyes       = []int{4, 5, 6, 7}
	// names are the AI racers' nicknames; a race draws distinct ones.
	names = []string{
		"疾风", "闪电", "飓风", "雷霆", "流星", "追风", "火箭", "极光", "飞鱼", "猎豹",
		"雪狼", "苍鹰", "银狐", "赤兔", "青龙", "白虎", "朱雀", "玄武", "麒麟", "飞燕",
		"海鸥", "云雀", "惊雷", "烈焰", "寒冰", "星辰", "月影", "晨曦", "暮光", "骄阳",
		"彩虹", "浪花", "山岚", "松涛", "竹影", "墨客", "剑客", "侠客", "小飞侠", "漂移王",
		"氮气侠", "弯道王", "直道王", "小旋风", "风火轮", "加速度", "超音速", "光速", "跑跑", "车神",
		"车王", "极速", "飞驰", "狂飙", "奔腾", "蓝鲸", "火狐", "黑豹", "金雕", "白鲨",
	}
)

// NamePrefix marks an AI racer's name.
const NamePrefix = "AI·"

// Kit is one AI racer's look.
type Kit struct {
	Name                  string
	Character, Paint, Dye int
}

// Kits draws count distinct names and random looks.
func Kits(count int, seed uint64) []Kit {
	rng := rand.New(rand.NewPCG(seed, ^seed))
	order := rng.Perm(len(names))
	kits := make([]Kit, count)
	for i := range kits {
		name := names[order[i%len(names)]]
		if i >= len(names) {
			name += string(rune('0' + i/len(names)))
		}
		kits[i] = Kit{Name: NamePrefix + name, Character: characters[rng.IntN(len(characters))],
			Paint: paints[rng.IntN(len(paints))], Dye: dyes[rng.IntN(len(dyes))]}
	}
	return kits
}
