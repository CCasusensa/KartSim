package store

import (
	"context"
	"database/sql"
	"net/http"

	"kartsim/internal/data/economy"
	"kartsim/internal/shared/apierr"
)

// The shop's 点击获取点券 button (ECONOMY.md 2.5): while the admin keeps it
// enabled, every click credits the configured amounts.

// ReasonShopClaim is the ledger reason of a shop claim; ref = requestId.
const ReasonShopClaim = "shopclaim"

// ErrShopClaimClosed is a claim while the admin has the button disabled.
var ErrShopClaimClosed = apierr.New(http.StatusForbidden, "SHOP_CLAIM_CLOSED")

// ShopClaimResult is what one click changed.
type ShopClaimResult struct {
	Wallet Wallet `json:"wallet"`
	// Granted is what this request credited (zero for a repeated requestId).
	Granted CurrencyGrant `json:"granted"`
	// Duplicate: the requestId had been credited before; nothing changed.
	Duplicate bool `json:"duplicate"`
}

// ClaimShopGrant credits the shop button's amounts (the settings as they
// are now, read in the same transaction) to accountID under the wallet
// lock. Each currency's ledger row is (reason "shopclaim", ref requestId),
// so repeating a requestId changes nothing and reports Duplicate. A credit
// that would pass MaxBalance is BALANCE_LIMIT; a disabled button is
// SHOP_CLAIM_CLOSED.
func (s *Store) ClaimShopGrant(ctx context.Context, accountID, requestID string, now int64) (ShopClaimResult, error) {
	var result ShopClaimResult
	err := inEconomyTx(ctx, s.db, nil, func(tx *sql.Tx) error {
		result = ShopClaimResult{}
		settings, err := s.economySettings(ctx, tx)
		if err != nil {
			return err
		}
		if !settings.ShopClaim.Enabled {
			return ErrShopClaimClosed
		}
		l, err := s.lockLedger(ctx, tx, accountID, now)
		if err != nil {
			return err
		}
		configured, applied := false, false
		for _, currency := range []economy.Currency{economy.Coupon, economy.Lucci, economy.Koin} {
			amount := settings.ShopClaim.Amount(currency)
			if amount <= 0 {
				continue
			}
			configured = true
			before := l.wallet.Get(currency)
			if amount > MaxBalance-before {
				return errBalanceLimit
			}
			ok, err := l.add(currency, amount, ReasonShopClaim, requestID, "")
			if err != nil {
				return err
			}
			if !ok {
				continue
			}
			applied = true
			granted := l.wallet.Get(currency) - before
			switch currency {
			case economy.Coupon:
				result.Granted.Coupon = granted
			case economy.Lucci:
				result.Granted.Lucci = granted
			case economy.Koin:
				result.Granted.Koin = granted
			}
		}
		result.Wallet = l.wallet
		result.Duplicate = configured && !applied
		return nil
	})
	return result, err
}
