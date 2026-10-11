package store_test

import (
	"database/sql"

	"kartsim/internal/data/store"
	"kartsim/internal/shared/rewards"
)

// newGrantlessStore is a store without the registration and per-race
// grants of ECONOMY.md 2.3/2.4 (only the starting lucci), for tests that
// count wallet balances from zero coupons and koin.
func newGrantlessStore(db *sql.DB) *store.Store {
	return store.New(db).WithEconomy(store.EconomyRules{StartingLucci: store.DefaultStartingLucci, Rates: rewards.DefaultRates()})
}
