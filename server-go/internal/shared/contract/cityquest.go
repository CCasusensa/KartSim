package contract

// 卡丁城送货任务 (CITY-QUESTS.md): a member who delivers a quest's item to
// its receiver within the quest's limits earns 金币 (lucci) and exp. The
// game node judges the delivery and asks the data service to credit the
// reward; the data service applies the configured rates and a daily cap.
const PathCityQuestReward = "/internal/v1/city/quest/reward"

// CityQuestRewardRequest credits one completed delivery. RunID names the
// accepted quest run: the ledger keeps (reason, RunID) once, so a retried
// call credits nothing more. Exp and Lucci are the base reward before the
// configured rates.
type CityQuestRewardRequest struct {
	AccountID string `json:"accountId"`
	RunID     string `json:"runId"`
	QuestID   string `json:"questId"`
	Exp       int64  `json:"exp"`
	Lucci     int64  `json:"lucci"`
}

// CityQuestLevelUp is a level reached by the reward's exp and what it paid.
type CityQuestLevelUp struct {
	Level  int   `json:"level"`
	Lucci  int64 `json:"lucci"`
	Koin   int64 `json:"koin"`
	Coupon int64 `json:"coupon"`
}

// CityQuestReward is what one delivery credited (0 and Capped past the
// daily cap, 0 and Duplicate for a run already credited) and the account
// afterwards.
type CityQuestReward struct {
	Exp       int64              `json:"exp"`
	Lucci     int64              `json:"lucci"`
	Capped    bool               `json:"capped"`
	Duplicate bool               `json:"duplicate"`
	LevelUps  []CityQuestLevelUp `json:"levelUps"`
	// Wallet and progress after the reward.
	WalletLucci int64 `json:"walletLucci"`
	TotalExp    int64 `json:"totalExp"`
	Level       int   `json:"level"`
}
