package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"kartsim/internal/data/datatest"
	"kartsim/internal/data/economy"
	"kartsim/internal/shared/contract"
)

// The game nodes' tank API (FUEL.md 3–4): the tank of the equipped kart
// from the generated table, saves, a refill at the admin's price and a
// rescue, with the inputs checked.
func TestCityFuelInternalAPI(t *testing.T) {
	h := newHarness(t, harnessOptions{mysql: true})
	datatest.LockEconomySettings(t, h.db)
	h.cleanup("DELETE FROM app_settings WHERE name = 'economy'")
	datatest.Exec(t, h.db, "DELETE FROM app_settings WHERE name = 'economy'")
	u := datatest.Unique()
	id, _ := h.register("fuel_"+u, "Fuel"+u)
	tanks, err := economy.DefaultTanks()
	if err != nil {
		t.Fatal(err)
	}
	practice, ok := tanks.ForSystem("practiceKart")
	if !ok {
		t.Fatal("the tank table has no practiceKart")
	}
	state := func(equipment string) contract.CityFuel {
		t.Helper()
		var fuel contract.CityFuel
		h.call(contract.PathCityFuelState, contract.CityFuelStateRequest{AccountID: id, Equipment: json.RawMessage(equipment)}).
			expect(t, http.StatusOK, "").json(t, &fuel)
		return fuel
	}
	fuel := state(`{"itemIds":{"1":2,"3":0},"systemKart":"practiceKart"}`)
	capacity := int64(practice.Capacity) * 1000
	if !fuel.Enabled || fuel.KartKey != "system:practiceKart" || fuel.CapacityML != capacity || fuel.FuelML != capacity ||
		fuel.Rev != 0 || fuel.SizeClass != practice.SizeClass || fuel.UseMLPerKm != 1600+30*int64(practice.Capacity) ||
		fuel.PricePerLiter != 5 || fuel.RescueFee != 300 || fuel.Lucci != harnessStartingLucci || fuel.KartName == "" {
		t.Fatalf("practice kart tank %+v", fuel)
	}
	big := state(`{"itemIds":{"3":837}}`) // 擎天柱
	if want, _ := tanks.ForItem(837); big.KartKey != "item:837" || big.CapacityML != int64(want.Capacity)*1000 || big.CapacityML <= capacity {
		t.Fatalf("擎天柱 tank %+v", big)
	}
	h.call(contract.PathCityFuelState, contract.CityFuelStateRequest{AccountID: id, Equipment: json.RawMessage(`{"itemIds":[]}`)}).
		expect(t, http.StatusBadRequest, "INVALID_EQUIPMENT")

	var saved contract.CityFuelSaveResponse
	h.call(contract.PathCityFuelSave, contract.CityFuelSaveRequest{AccountID: id, KartKey: fuel.KartKey, FuelML: 1000, Rev: 0}).
		expect(t, http.StatusOK, "").json(t, &saved)
	if !saved.Applied || saved.FuelML != 1000 || saved.Rev != 1 {
		t.Fatalf("save %+v", saved)
	}
	h.call(contract.PathCityFuelSave, contract.CityFuelSaveRequest{AccountID: id, KartKey: "item:x", FuelML: 1, Rev: 1}).
		expect(t, http.StatusBadRequest, "INVALID_KART_KEY")
	h.call(contract.PathCityFuelSave, contract.CityFuelSaveRequest{AccountID: id, KartKey: fuel.KartKey, FuelML: capacity + 1, Rev: 1}).
		expect(t, http.StatusBadRequest, "INVALID_FUEL")

	var charge contract.CityFuelCharge
	h.call(contract.PathCityFuelRefuel, contract.CityFuelRefuelRequest{AccountID: id, KartKey: fuel.KartKey, RequestID: "fill-" + u,
		FuelML: 1000, Rev: 1}).expect(t, http.StatusOK, "").json(t, &charge)
	cost := ((capacity-1000)*5 + 999) / 1000
	if charge.FuelML != capacity || charge.AddedML != capacity-1000 || charge.Cost != cost || charge.Lucci != harnessStartingLucci-cost ||
		charge.Rev != 2 || charge.Stale {
		t.Fatalf("refuel %+v (cost %d)", charge, cost)
	}
	h.call(contract.PathCityFuelRefuel, contract.CityFuelRefuelRequest{AccountID: id, KartKey: fuel.KartKey, RequestID: "full-" + u,
		FuelML: capacity, Rev: 2}).expect(t, http.StatusConflict, "TANK_FULL")
	h.call(contract.PathCityFuelRefuel, contract.CityFuelRefuelRequest{AccountID: id, KartKey: fuel.KartKey, RequestID: "",
		FuelML: 0, Rev: 2}).expect(t, http.StatusBadRequest, "INVALID_REQUEST_ID")

	h.call(contract.PathCityFuelRescue, contract.CityFuelRescueRequest{AccountID: id, KartKey: fuel.KartKey, RequestID: "tow-" + u,
		FuelML: 0, Rev: 2}).expect(t, http.StatusOK, "").json(t, &charge)
	if charge.Cost != 300 || charge.Lucci != harnessStartingLucci-cost-300 || charge.FuelML != 0 || charge.Rev != 3 {
		t.Fatalf("rescue %+v", charge)
	}
	if again := state(`{"itemIds":{"3":0},"systemKart":"practiceKart"}`); again.FuelML != 0 || again.Rev != 3 {
		t.Fatalf("stored tank %+v", again)
	}
}
