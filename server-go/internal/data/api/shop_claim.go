package api

import (
	"net/http"
)

// The shop's 点击获取点券 button (ECONOMY.md 2.5): the browser asks whether
// it is shown and what a click gives, and claims with one requestId per
// click (a retry of the same click cannot credit twice).

// shopClaimJSON is the GET /api/shop/free-coupon body.
type shopClaimJSON struct {
	Enabled    bool  `json:"enabled"`
	Coupon     int64 `json:"coupon"`
	Lucci      int64 `json:"lucci"`
	Koin       int64 `json:"koin"`
	ServerTime int64 `json:"serverTime"`
}

// shopClaimStatus answers the button's settings in effect.
func (a *API) shopClaimStatus(w http.ResponseWriter, r *http.Request) error {
	if _, err := a.signedIn(r); err != nil {
		return err
	}
	settings, err := a.store.EconomySettings(r.Context())
	if err != nil {
		return err
	}
	claim := settings.ShopClaim
	return writeJSON(w, http.StatusOK, shopClaimJSON{Enabled: claim.Enabled,
		Coupon: claim.Coupon, Lucci: claim.Lucci, Koin: claim.Koin, ServerTime: a.nowMillis()})
}

// shopClaim credits one click: {requestId} → {wallet, granted, duplicate}.
// 403 SHOP_CLAIM_CLOSED while the admin has the button off, 409
// BALANCE_LIMIT at the wallet cap; the per-account write limit applies.
func (a *API) shopClaim(w http.ResponseWriter, r *http.Request) error {
	var request struct {
		RequestID string `json:"requestId"`
	}
	if err := decodeJSON(w, r, &request); err != nil {
		return err
	}
	account, err := a.signedIn(r)
	if err != nil {
		return err
	}
	id, err := requestID(request.RequestID)
	if err != nil {
		return err
	}
	if err := a.accountWrite(r.Context(), account.ID); err != nil {
		return err
	}
	result, err := a.store.ClaimShopGrant(r.Context(), account.ID, id, a.nowMillis())
	if err != nil {
		return err
	}
	if !result.Duplicate {
		a.log.Debug("shop claim", "username", account.Username, "coupon", result.Granted.Coupon,
			"lucci", result.Granted.Lucci, "koin", result.Granted.Koin)
	}
	return writeJSON(w, http.StatusOK, result)
}
