package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"kartsim/internal/data/economy"
	"kartsim/internal/shared/contract"
)

// Admin-set economy settings (ECONOMY.md 2.3 and 2.4): what a new account
// receives and what every finished online race adds. They live in
// app_settings (schema v15) as one JSON row; absent, the defaults apply.

const (
	settingsEconomy = "economy"
	// DefaultRegisterCoupon and DefaultRegisterKoin are what a new account
	// receives besides its starting lucci until the admin changes it.
	DefaultRegisterCoupon = 20_000
	DefaultRegisterKoin   = 20_000
	// DefaultRaceCoupon is the 点券 a finished online race adds by default.
	DefaultRaceCoupon = 100
	// MaxGrantAmount bounds every admin-set grant.
	MaxGrantAmount = contract.MaxCurrencyGrant
)

// CurrencyGrant is an amount of each currency.
type CurrencyGrant struct {
	Coupon int64 `json:"coupon"`
	Lucci  int64 `json:"lucci"`
	Koin   int64 `json:"koin"`
}

// Amount returns the grant's amount of one currency.
func (g CurrencyGrant) Amount(currency economy.Currency) int64 {
	switch currency {
	case economy.Coupon:
		return g.Coupon
	case economy.Lucci:
		return g.Lucci
	case economy.Koin:
		return g.Koin
	}
	return 0
}

// Valid reports whether every amount is within 0 and MaxGrantAmount.
func (g CurrencyGrant) Valid() bool {
	for _, amount := range []int64{g.Coupon, g.Lucci, g.Koin} {
		if amount < 0 || amount > MaxGrantAmount {
			return false
		}
	}
	return true
}

// EconomySettings are the grants the admin console sets.
type EconomySettings struct {
	// Register is credited when an account's wallet is created (reason
	// "starter", ref "signup").
	Register CurrencyGrant `json:"register"`
	// Race is credited to every racer who finished an online race, on top
	// of the formula rewards and outside the daily caps (reason "racebonus",
	// ref = raceId).
	Race      CurrencyGrant `json:"race"`
	UpdatedAt int64         `json:"updatedAt"`
	UpdatedBy string        `json:"updatedBy"`
}

var errInvalidEconomySettings = errors.New("economy settings out of range")

// DefaultEconomySettings are the settings before the admin saves any
// (KART_STARTING_LUCCI/COUPON/KOIN and KART_RACE_COUPON).
func (s *Store) DefaultEconomySettings() EconomySettings {
	return EconomySettings{
		Register: CurrencyGrant{Coupon: s.rules.StartingCoupon, Lucci: s.rules.StartingLucci, Koin: s.rules.StartingKoin},
		Race:     CurrencyGrant{Coupon: s.rules.RaceCoupon},
	}
}

type settingsQuerier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// EconomySettings returns the stored settings, or the defaults.
func (s *Store) EconomySettings(ctx context.Context) (EconomySettings, error) {
	return s.economySettings(ctx, s.db)
}

func (s *Store) economySettings(ctx context.Context, q settingsQuerier) (EconomySettings, error) {
	settings := s.DefaultEconomySettings()
	var raw string
	err := q.QueryRowContext(ctx, "SELECT json, updated_at, updated_by FROM app_settings WHERE name = ?",
		settingsEconomy).Scan(&raw, &settings.UpdatedAt, &settings.UpdatedBy)
	if errors.Is(err, sql.ErrNoRows) {
		return settings, nil
	} else if err != nil {
		return settings, err
	}
	var stored struct {
		Register CurrencyGrant `json:"register"`
		Race     CurrencyGrant `json:"race"`
	}
	if err := json.Unmarshal([]byte(raw), &stored); err != nil {
		return settings, fmt.Errorf("economy settings: %w", err)
	}
	settings.Register, settings.Race = stored.Register, stored.Race
	return settings, nil
}

// SaveEconomySettings stores the grants (each amount 0–MaxGrantAmount)
// with who changed them and returns what is now in effect.
func (s *Store) SaveEconomySettings(ctx context.Context, settings EconomySettings, admin string, now int64) (EconomySettings, error) {
	if !settings.Register.Valid() || !settings.Race.Valid() {
		return EconomySettings{}, errInvalidEconomySettings
	}
	encoded, err := json.Marshal(struct {
		Register CurrencyGrant `json:"register"`
		Race     CurrencyGrant `json:"race"`
	}{settings.Register, settings.Race})
	if err != nil {
		return EconomySettings{}, err
	}
	if _, err := s.db.ExecContext(ctx, `INSERT INTO app_settings(name, json, updated_at, updated_by)
		VALUES(?, ?, ?, ?) AS incoming
		ON DUPLICATE KEY UPDATE json = incoming.json, updated_at = incoming.updated_at, updated_by = incoming.updated_by`,
		settingsEconomy, string(encoded), now, admin); err != nil {
		return EconomySettings{}, err
	}
	return s.EconomySettings(ctx)
}
