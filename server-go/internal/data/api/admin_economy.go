package api

import (
	"net/http"

	"kartsim/internal/data/store"
	"kartsim/internal/shared/apierr"
)

// The admin console's 经济设置 page (ADMIN.md 3, ECONOMY.md 2.3–2.5): what
// a new account receives, what every finished online race adds, and the
// shop's 点击获取点券 button.

var errInvalidEconomySettings = apierr.New(http.StatusBadRequest, "INVALID_ECONOMY_SETTINGS")

type economySettingsJSON struct {
	Register  store.CurrencyGrant     `json:"register"`
	Race      store.CurrencyGrant     `json:"race"`
	ShopClaim store.ShopClaimSettings `json:"shopClaim"`
	UpdatedAt int64                   `json:"updatedAt"`
	UpdatedBy string                  `json:"updatedBy"`
	// Defaults are the settings in effect before any were saved.
	Defaults struct {
		Register  store.CurrencyGrant     `json:"register"`
		Race      store.CurrencyGrant     `json:"race"`
		ShopClaim store.ShopClaimSettings `json:"shopClaim"`
	} `json:"defaults"`
	ServerTime int64 `json:"serverTime"`
}

func (a *API) economySettingsJSON(settings store.EconomySettings, now int64) economySettingsJSON {
	defaults := a.store.DefaultEconomySettings()
	out := economySettingsJSON{Register: settings.Register, Race: settings.Race, ShopClaim: settings.ShopClaim,
		UpdatedAt: settings.UpdatedAt, UpdatedBy: settings.UpdatedBy, ServerTime: now}
	out.Defaults.Register, out.Defaults.Race, out.Defaults.ShopClaim = defaults.Register, defaults.Race, defaults.ShopClaim
	return out
}

// adminEconomy answers the grants in effect.
func (a *API) adminEconomy(w http.ResponseWriter, r *http.Request) error {
	if _, err := a.requireAdmin(r); err != nil {
		return err
	}
	settings, err := a.store.EconomySettings(r.Context())
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, a.economySettingsJSON(settings, a.nowMillis()))
}

// adminSaveEconomy stores {register{coupon,lucci,koin}, race{…},
// shopClaim{enabled,coupon,lucci,koin}}, each amount 0–contract.MaxCurrencyGrant,
// and answers what is now in effect. A body without shopClaim keeps the
// button as it is. Game nodes pick the per-race grant up with their next
// heartbeat; the shop button follows on its next opening.
func (a *API) adminSaveEconomy(w http.ResponseWriter, r *http.Request) error {
	var request struct {
		Register  store.CurrencyGrant      `json:"register"`
		Race      store.CurrencyGrant      `json:"race"`
		ShopClaim *store.ShopClaimSettings `json:"shopClaim"`
	}
	if err := decodeJSON(w, r, &request); err != nil {
		return err
	}
	admin, err := a.requireAdmin(r)
	if err != nil {
		return err
	}
	current, err := a.store.EconomySettings(r.Context())
	if err != nil {
		return err
	}
	settings := store.EconomySettings{Register: request.Register, Race: request.Race, ShopClaim: current.ShopClaim}
	if request.ShopClaim != nil {
		settings.ShopClaim = *request.ShopClaim
	}
	if !settings.Valid() {
		return errInvalidEconomySettings
	}
	now := a.nowMillis()
	settings, err = a.store.SaveEconomySettings(r.Context(), settings, admin.Username, now)
	if err != nil {
		return err
	}
	a.log.Info("admin economy settings", "admin", admin.Username,
		"registerCoupon", settings.Register.Coupon, "registerLucci", settings.Register.Lucci,
		"registerKoin", settings.Register.Koin, "raceCoupon", settings.Race.Coupon,
		"raceLucci", settings.Race.Lucci, "raceKoin", settings.Race.Koin,
		"shopClaim", settings.ShopClaim.Enabled, "shopClaimCoupon", settings.ShopClaim.Coupon,
		"shopClaimLucci", settings.ShopClaim.Lucci, "shopClaimKoin", settings.ShopClaim.Koin)
	return writeJSON(w, http.StatusOK, a.economySettingsJSON(settings, now))
}
