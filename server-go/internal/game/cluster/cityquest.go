package cluster

import (
	"context"

	"kartsim/internal/game/city"
	"kartsim/internal/shared/contract"
)

// CityQuests credits 卡丁城 deliveries on the data service
// (contract.PathCityQuestReward). It implements city.QuestRewards.
type CityQuests struct {
	data *DataClient
}

var _ city.QuestRewards = (*CityQuests)(nil)

// NewCityQuests returns the delivery reward API over data.
func NewCityQuests(data *DataClient) *CityQuests { return &CityQuests{data: data} }

// Reward credits one delivery.
func (q *CityQuests) Reward(ctx context.Context, request contract.CityQuestRewardRequest) (contract.CityQuestReward, error) {
	var reward contract.CityQuestReward
	err := q.data.Call(ctx, contract.PathCityQuestReward, request, &reward)
	return reward, err
}
