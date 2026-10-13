package cluster

import (
	"context"
	"encoding/json"

	"kartsim/internal/game/city"
	"kartsim/internal/shared/contract"
)

// CityFuel is the city's tank API on the data service
// (contract.PathCityFuel*). It implements city.Fuel.
type CityFuel struct {
	data *DataClient
}

var _ city.Fuel = (*CityFuel)(nil)

// NewCityFuel returns the tank API over data.
func NewCityFuel(data *DataClient) *CityFuel { return &CityFuel{data: data} }

// State returns the tank of the kart equipment drives.
func (f *CityFuel) State(ctx context.Context, accountID string, equipment json.RawMessage) (contract.CityFuel, error) {
	var state contract.CityFuel
	err := f.data.Call(ctx, contract.PathCityFuelState,
		contract.CityFuelStateRequest{AccountID: accountID, Equipment: equipment}, &state)
	return state, err
}

// Save stores a tank's level.
func (f *CityFuel) Save(ctx context.Context, request contract.CityFuelSaveRequest) (contract.CityFuelSaveResponse, error) {
	var response contract.CityFuelSaveResponse
	err := f.data.Call(ctx, contract.PathCityFuelSave, request, &response)
	return response, err
}

// Refuel buys fuel.
func (f *CityFuel) Refuel(ctx context.Context, request contract.CityFuelRefuelRequest) (contract.CityFuelCharge, error) {
	var charge contract.CityFuelCharge
	err := f.data.Call(ctx, contract.PathCityFuelRefuel, request, &charge)
	return charge, err
}

// Rescue pays a tow.
func (f *CityFuel) Rescue(ctx context.Context, request contract.CityFuelRescueRequest) (contract.CityFuelCharge, error) {
	var charge contract.CityFuelCharge
	err := f.data.Call(ctx, contract.PathCityFuelRescue, request, &charge)
	return charge, err
}
