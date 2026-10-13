package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"kartsim/internal/data/economy"
	"kartsim/internal/data/store"
	"kartsim/internal/shared/apierr"
	"kartsim/internal/shared/contract"
)

// 卡丁城 fuel (FUEL.md): the game nodes' calls for a city member's tank.
// The node measures the driving and checks the station; the data service
// knows the tank sizes, keeps the tanks and charges the wallet.

var (
	errInvalidKartKey = apierr.New(http.StatusBadRequest, "INVALID_KART_KEY")
	errInvalidFuel    = apierr.New(http.StatusBadRequest, "INVALID_FUEL")
)

// Fuel burn (FUEL.md 2): a kilometre burns 0.8 L plus 0.015 L per litre of
// tank, so bigger karts go further on a full tank but cost more per km.
// (Halved on 2026-10-13: a full tank goes twice as far.)
const (
	fuelBaseMLPerKm     = 800
	fuelPerLiterMLPerKm = 15
)

// fuelUse is the ml one kilometre burns for a tank of capacityL litres at
// the admin's consumption percent.
func fuelUse(capacityL, percent int64) int64 {
	return max(1, (fuelBaseMLPerKm+fuelPerLiterMLPerKm*capacityL)*percent/100)
}

// fuelKart is the kart a tank belongs to.
type fuelKart struct {
	key  string
	name string
	tank economy.Tank
}

func (k fuelKart) capacityML() int64 { return int64(k.tank.Capacity) * 1000 }

// fuelKartOf is the kart of an equipment document's slot 3: "item:<id>"
// for a catalog kart, "system:<systemKart>" for a free one.
func (a *API) fuelKartOf(equipment json.RawMessage) (fuelKart, error) {
	doc, err := parseEquipment(equipment)
	if err != nil {
		return fuelKart{}, errInvalidEquipment
	}
	items, err := doc.items()
	if err != nil {
		return fuelKart{}, errInvalidEquipment
	}
	for _, item := range items {
		if item.Slot != economy.CategoryKart {
			continue
		}
		key := "item:" + strconv.Itoa(item.ItemID)
		if item.ItemID == 0 {
			key = "system:" + item.SystemKey
		}
		if kart, ok := a.fuelKartByKey(key); ok {
			return kart, nil
		}
		break
	}
	return fuelKart{}, errInvalidEquipment
}

// fuelKartByKey resolves a kart key; a kart the tank table does not list
// gets the default tank.
func (a *API) fuelKartByKey(key string) (fuelKart, bool) {
	if len(key) > 72 || !validASCIIID(key, 72) {
		return fuelKart{}, false
	}
	tanks, err := economy.DefaultTanks()
	if err != nil {
		a.log.Error("kart tank table", "error", err)
		tanks = nil
	}
	kart := fuelKart{key: key}
	var found bool
	if rest, ok := strings.CutPrefix(key, "item:"); ok {
		itemID, err := strconv.Atoi(rest)
		if err != nil || itemID <= 0 || itemID > maxSlotItemID || strconv.Itoa(itemID) != rest {
			return fuelKart{}, false
		}
		if tanks != nil {
			kart.tank, found = tanks.ForItem(itemID)
		}
		kart.name = a.itemName(economy.CategoryKart, itemID, "")
	} else if rest, ok := strings.CutPrefix(key, "system:"); ok {
		if tanks != nil {
			kart.tank, found = tanks.ForSystem(rest)
		}
		kart.name = a.itemName(economy.CategoryKart, 0, rest)
	} else {
		return fuelKart{}, false
	}
	if !found {
		kart.tank = economy.Tank{Capacity: economy.DefaultTankLiters, SizeClass: economy.TankMedium}
	}
	if kart.name == "" {
		kart.name = kart.tank.Name
	}
	if kart.name == "" {
		kart.name = "卡丁车"
	}
	return kart, true
}

// cityFuelState answers a member's tank (contract PathCityFuelState).
func (a *API) cityFuelState(w http.ResponseWriter, r *http.Request) error {
	var request contract.CityFuelStateRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return err
	}
	if !validASCIIID(request.AccountID, 36) {
		return errInvalidAccountID
	}
	kart, err := a.fuelKartOf(request.Equipment)
	if err != nil {
		return err
	}
	settings, err := a.store.EconomySettings(r.Context())
	if err != nil {
		return err
	}
	tank, err := a.store.FuelTank(r.Context(), request.AccountID, kart.key, kart.capacityML())
	if err != nil {
		return err
	}
	lucci, err := a.store.Lucci(r.Context(), request.AccountID, a.nowMillis())
	if err != nil {
		return err
	}
	fuel := settings.CityFuel
	return writeJSON(w, http.StatusOK, contract.CityFuel{
		Enabled: fuel.Enabled, KartKey: kart.key, KartName: kart.name, SizeClass: kart.tank.SizeClass,
		CapacityML: kart.capacityML(), FuelML: tank.FuelML, Rev: tank.Rev,
		UseMLPerKm:    fuelUse(int64(kart.tank.Capacity), fuel.Consumption()),
		PricePerLiter: fuel.PricePerLiter, RescueFee: fuel.RescueFee, Lucci: lucci,
	})
}

// fuelRequest validates the fields every write carries.
func (a *API) fuelRequest(accountID, kartKey string, fuelML, rev int64) (fuelKart, error) {
	if !validASCIIID(accountID, 36) {
		return fuelKart{}, errInvalidAccountID
	}
	kart, ok := a.fuelKartByKey(kartKey)
	if !ok {
		return fuelKart{}, errInvalidKartKey
	}
	if fuelML < 0 || fuelML > kart.capacityML() || rev < 0 {
		return fuelKart{}, errInvalidFuel
	}
	return kart, nil
}

// cityFuelSave stores a member's level (contract PathCityFuelSave).
func (a *API) cityFuelSave(w http.ResponseWriter, r *http.Request) error {
	var request contract.CityFuelSaveRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return err
	}
	kart, err := a.fuelRequest(request.AccountID, request.KartKey, request.FuelML, request.Rev)
	if err != nil {
		return err
	}
	tank, applied, err := a.store.SaveFuel(r.Context(), request.AccountID, kart.key, kart.capacityML(),
		request.FuelML, request.Rev, a.nowMillis())
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, contract.CityFuelSaveResponse{FuelML: tank.FuelML, Rev: tank.Rev, Applied: applied})
}

func (a *API) fuelOrder(accountID, tankAccountID, kartKey, requestID string, fuelML, rev, addML int64) (store.FuelOrder, error) {
	kart, err := a.fuelRequest(accountID, kartKey, fuelML, rev)
	if err != nil {
		return store.FuelOrder{}, err
	}
	if tankAccountID != "" && !validASCIIID(tankAccountID, 36) {
		return store.FuelOrder{}, errInvalidAccountID
	}
	if !validASCIIID(requestID, 64) {
		return store.FuelOrder{}, errInvalidRequestID
	}
	if addML < 0 {
		return store.FuelOrder{}, errInvalidFuel
	}
	return store.FuelOrder{AccountID: accountID, TankAccountID: tankAccountID, KartKey: kart.key, RequestID: requestID,
		CapacityML: kart.capacityML(), FuelML: fuelML, Rev: rev, AddML: addML}, nil
}

func fuelChargeJSON(charge store.FuelCharge) contract.CityFuelCharge {
	return contract.CityFuelCharge{FuelML: charge.FuelML, Rev: charge.Rev, AddedML: charge.AddedML, Cost: charge.Cost,
		Lucci: charge.Wallet.Lucci, Free: charge.Free, Stale: charge.Stale}
}

// cityFuelRefuel sells a member fuel at a station (contract
// PathCityFuelRefuel): 409 INSUFFICIENT_FUNDS or TANK_FULL, 403
// CITY_FUEL_OFF.
func (a *API) cityFuelRefuel(w http.ResponseWriter, r *http.Request) error {
	var request contract.CityFuelRefuelRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return err
	}
	order, err := a.fuelOrder(request.AccountID, request.TankAccountID, request.KartKey, request.RequestID, request.FuelML,
		request.Rev, request.AddML)
	if err != nil {
		return err
	}
	charge, err := a.store.Refuel(r.Context(), order, a.nowMillis())
	if err != nil {
		return err
	}
	if !charge.Stale {
		a.log.Info("city refuel", "account", order.AccountID, "kart", order.KartKey,
			"addedMl", charge.AddedML, "cost", charge.Cost)
	}
	return writeJSON(w, http.StatusOK, fuelChargeJSON(charge))
}

// cityFuelRescue pays the tow of a stalled member (contract
// PathCityFuelRescue): 403 CITY_FUEL_OFF.
func (a *API) cityFuelRescue(w http.ResponseWriter, r *http.Request) error {
	var request contract.CityFuelRescueRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return err
	}
	order, err := a.fuelOrder(request.AccountID, request.TankAccountID, request.KartKey, request.RequestID, request.FuelML,
		request.Rev, 0)
	if err != nil {
		return err
	}
	charge, err := a.store.RescueKart(r.Context(), order, a.nowMillis())
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, fuelChargeJSON(charge))
}
