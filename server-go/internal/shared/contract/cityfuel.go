package contract

import "encoding/json"

// 卡丁城加油 (FUEL.md): every kart an account owns has a fuel tank that
// lasts across visits; driving in the city burns it, the city's gas
// stations refill it for 金币 (lucci) and an empty tank stalls the kart
// until a paid rescue tows it to a station. The data service keeps the
// tanks and the wallet; the game node measures what a member drives, checks
// that it is at a station and makes these calls on the member's behalf.
//
// Fuel is in millilitres. Every write carries the row revision the node
// last saw (Rev) and is applied only when the row still has it, so a
// retried call never applies twice and a stale save never overwrites a
// refill.
const (
	PathCityFuelState  = "/internal/v1/city/fuel/state"
	PathCityFuelSave   = "/internal/v1/city/fuel/save"
	PathCityFuelRefuel = "/internal/v1/city/fuel/refuel"
	PathCityFuelRescue = "/internal/v1/city/fuel/rescue"
)

// CityFuelStateRequest asks for the tank of the kart an equipment document
// drives (slot 3 and systemKart, like PathEquipmentVerify).
type CityFuelStateRequest struct {
	AccountID string          `json:"accountId"`
	Equipment json.RawMessage `json:"equipment"`
}

// CityFuel is one kart's tank and the prices in effect.
type CityFuel struct {
	// Enabled is false while the admin has fuel switched off: tanks are
	// neither burnt nor shown.
	Enabled bool `json:"enabled"`
	// KartKey names the kart: "item:<itemId>" or "system:<systemKart>".
	KartKey  string `json:"kartKey"`
	KartName string `json:"kartName"`
	// SizeClass is the tank class: small, medium, large or huge.
	SizeClass  string `json:"sizeClass"`
	CapacityML int64  `json:"capacityMl"`
	FuelML     int64  `json:"fuelMl"`
	Rev        int64  `json:"rev"`
	// UseMLPerKm is what one kilometre of driving burns.
	UseMLPerKm int64 `json:"useMlPerKm"`
	// PricePerLiter is in 金币; a refill costs ceil(added ml × price / 1000).
	PricePerLiter int64 `json:"pricePerLiter"`
	// RescueFee is the 金币 a tow to a station costs (free when the wallet
	// holds less).
	RescueFee int64 `json:"rescueFee"`
	Lucci     int64 `json:"lucci"`
}

// CityFuelSaveRequest stores what the member has left after driving.
type CityFuelSaveRequest struct {
	AccountID string `json:"accountId"`
	KartKey   string `json:"kartKey"`
	FuelML    int64  `json:"fuelMl"`
	Rev       int64  `json:"rev"`
}

// CityFuelSaveResponse is the tank after a save; Applied is false when the
// row had another revision (FuelML and Rev are then the stored ones).
type CityFuelSaveResponse struct {
	FuelML  int64 `json:"fuelMl"`
	Rev     int64 `json:"rev"`
	Applied bool  `json:"applied"`
}

// CityFuelRefuelRequest buys AddML (at most what fits; 0 fills the tank)
// on top of FuelML, which the node measured since Rev. RequestID is the
// ledger reference (reason "cityfuel"). AccountID pays; TankAccountID owns
// the kart (a member driving someone else's kart fills the owner's tank;
// empty means AccountID).
type CityFuelRefuelRequest struct {
	AccountID     string `json:"accountId"`
	TankAccountID string `json:"tankAccountId,omitempty"`
	KartKey       string `json:"kartKey"`
	RequestID     string `json:"requestId"`
	FuelML        int64  `json:"fuelMl"`
	Rev           int64  `json:"rev"`
	AddML         int64  `json:"addMl"`
}

// CityFuelRescueRequest pays the tow of a stalled kart (reason
// "cityrescue", ref RequestID) and stores FuelML; AccountID pays,
// TankAccountID owns the kart (empty: AccountID).
type CityFuelRescueRequest struct {
	AccountID     string `json:"accountId"`
	TankAccountID string `json:"tankAccountId,omitempty"`
	KartKey       string `json:"kartKey"`
	RequestID     string `json:"requestId"`
	FuelML        int64  `json:"fuelMl"`
	Rev           int64  `json:"rev"`
}

// CityFuelCharge is the tank and wallet after a refuel or a rescue. Cost
// is what this call charged; Free marks a rescue the wallet could not pay;
// Stale is a call whose Rev the row no longer had: nothing was charged and
// FuelML/Rev are the stored ones.
type CityFuelCharge struct {
	FuelML  int64 `json:"fuelMl"`
	Rev     int64 `json:"rev"`
	AddedML int64 `json:"addedMl"`
	Cost    int64 `json:"cost"`
	Lucci   int64 `json:"lucci"`
	Free    bool  `json:"free,omitempty"`
	Stale   bool  `json:"stale,omitempty"`
}
