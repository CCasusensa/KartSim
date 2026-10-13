package store

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strconv"

	"kartsim/internal/data/economy"
	"kartsim/internal/shared/apierr"
)

// 卡丁城 fuel tanks (FUEL.md 3): kart_fuel (schema v22) holds what each kart
// of an account has left, in millilitres. A kart without a row has a full
// tank (a new kart arrives full). rev counts the writes: every write names
// the revision it was measured against and is applied only when the row
// still has it, so a retried or late call never applies twice.

// Ledger reasons of the city's fuel; ref = the node's requestId.
const (
	ReasonCityFuel   = "cityfuel"
	ReasonCityRescue = "cityrescue"
)

var (
	// ErrCityFuelOff is a refuel or rescue while the admin has fuel off.
	ErrCityFuelOff = apierr.New(http.StatusForbidden, "CITY_FUEL_OFF")
	// ErrTankFull is a refuel with nothing left to add.
	ErrTankFull = apierr.New(http.StatusConflict, "TANK_FULL")
)

// FuelTank is a kart's stored tank. Rev 0 is a tank never written.
type FuelTank struct {
	FuelML int64
	Rev    int64
}

// FuelCharge is a tank and wallet after a refuel or a rescue; Stale marks
// a call whose revision the row no longer had (nothing changed).
type FuelCharge struct {
	FuelML, Rev, AddedML, Cost int64
	Wallet                     Wallet
	Free, Stale                bool
}

// FuelOrder is one refuel or rescue: who pays (AccountID), whose kart it
// is (TankAccountID; empty means the payer's), the level the node measured
// since Rev, and for a refuel the millilitres to buy (0: fill up).
type FuelOrder struct {
	AccountID, TankAccountID, KartKey, RequestID string
	CapacityML, FuelML, Rev                      int64
	AddML                                        int64
}

// tankAccount is the account whose kart_fuel row the order changes.
func (o FuelOrder) tankAccount() string {
	if o.TankAccountID != "" {
		return o.TankAccountID
	}
	return o.AccountID
}

// FuelCost is what adding ml costs at pricePerLiter 金币: whole 金币,
// rounded up, so any refill of a priced fuel costs at least one.
func FuelCost(ml, pricePerLiter int64) int64 {
	if ml <= 0 || pricePerLiter <= 0 {
		return 0
	}
	return (ml*pricePerLiter + 999) / 1000
}

// FuelTank returns the tank of (accountID, kartKey), never above
// capacityML (a table change may have shrunk it); a missing row is full.
func (s *Store) FuelTank(ctx context.Context, accountID, kartKey string, capacityML int64) (FuelTank, error) {
	tank := FuelTank{FuelML: capacityML}
	err := s.db.QueryRowContext(ctx, "SELECT fuel_ml, rev FROM kart_fuel WHERE account_id = ? AND kart_key = ?",
		accountID, kartKey).Scan(&tank.FuelML, &tank.Rev)
	if errors.Is(err, sql.ErrNoRows) {
		return FuelTank{FuelML: capacityML}, nil
	} else if err != nil {
		return FuelTank{}, err
	}
	tank.FuelML = min(max(tank.FuelML, 0), capacityML)
	return tank, nil
}

// Lucci returns the account's 金币, creating its wallet (with the starting
// grants) when it has none yet.
func (s *Store) Lucci(ctx context.Context, accountID string, now int64) (int64, error) {
	var lucci int64
	err := s.db.QueryRowContext(ctx, "SELECT lucci FROM wallets WHERE account_id = ?", accountID).Scan(&lucci)
	if !errors.Is(err, sql.ErrNoRows) {
		return lucci, err
	}
	err = inEconomyTx(ctx, s.db, nil, func(tx *sql.Tx) error {
		l, err := s.lockLedger(ctx, tx, accountID, now)
		if err == nil {
			lucci = l.wallet.Lucci
		}
		return err
	})
	return lucci, err
}

// lockFuel creates the row (full) when it is missing and locks it.
func lockFuel(ctx context.Context, tx *sql.Tx, accountID, kartKey string, capacityML, now int64) (FuelTank, error) {
	if _, err := tx.ExecContext(ctx, `INSERT INTO kart_fuel(account_id, kart_key, fuel_ml, rev, updated_at)
		VALUES(?, ?, ?, 0, ?) ON DUPLICATE KEY UPDATE account_id = account_id`, accountID, kartKey, capacityML, now); err != nil {
		if missingParent(err) {
			return FuelTank{}, errAccountNotFound
		}
		return FuelTank{}, err
	}
	var tank FuelTank
	if err := tx.QueryRowContext(ctx, "SELECT fuel_ml, rev FROM kart_fuel WHERE account_id = ? AND kart_key = ? FOR UPDATE",
		accountID, kartKey).Scan(&tank.FuelML, &tank.Rev); err != nil {
		return FuelTank{}, err
	}
	tank.FuelML = min(max(tank.FuelML, 0), capacityML)
	return tank, nil
}

func writeFuel(ctx context.Context, tx *sql.Tx, accountID, kartKey string, fuelML, rev, now int64) error {
	_, err := tx.ExecContext(ctx, "UPDATE kart_fuel SET fuel_ml = ?, rev = ?, updated_at = ? WHERE account_id = ? AND kart_key = ?",
		fuelML, rev, now, accountID, kartKey)
	return err
}

// measured is the level a node reports: never more than the row holds
// (driving only burns fuel) and never below zero.
func measured(reported int64, stored FuelTank) int64 { return min(max(reported, 0), stored.FuelML) }

// SaveFuel stores fuelML for a tank last seen at rev. It reports false and
// the stored tank when the row has another revision.
func (s *Store) SaveFuel(ctx context.Context, accountID, kartKey string, capacityML, fuelML, rev, now int64) (FuelTank, bool, error) {
	var (
		result  FuelTank
		applied bool
	)
	err := inEconomyTx(ctx, s.db, nil, func(tx *sql.Tx) error {
		stored, err := lockFuel(ctx, tx, accountID, kartKey, capacityML, now)
		if err != nil {
			return err
		}
		if stored.Rev != rev {
			result, applied = stored, false
			return nil
		}
		result, applied = FuelTank{FuelML: measured(fuelML, stored), Rev: rev + 1}, true
		return writeFuel(ctx, tx, accountID, kartKey, result.FuelML, result.Rev, now)
	})
	return result, applied, err
}

// Refuel buys fuel at the admin's price (FUEL.md 4.2): order.AddML, at most
// what fits on top of the measured level (0 buys what fits), for
// FuelCost 金币 under the wallet lock (ledger reason "cityfuel", ref
// requestId). Too few 金币 is INSUFFICIENT_FUNDS, a full tank TANK_FULL,
// fuel switched off CITY_FUEL_OFF.
func (s *Store) Refuel(ctx context.Context, order FuelOrder, now int64) (FuelCharge, error) {
	var charge FuelCharge
	err := inEconomyTx(ctx, s.db, nil, func(tx *sql.Tx) error {
		charge = FuelCharge{}
		settings, err := s.economySettings(ctx, tx)
		if err != nil {
			return err
		}
		if !settings.CityFuel.Enabled {
			return ErrCityFuelOff
		}
		l, err := s.lockLedger(ctx, tx, order.AccountID, now)
		if err != nil {
			return err
		}
		stored, err := lockFuel(ctx, tx, order.tankAccount(), order.KartKey, order.CapacityML, now)
		if err != nil {
			return err
		}
		if stored.Rev != order.Rev {
			charge = FuelCharge{FuelML: stored.FuelML, Rev: stored.Rev, Wallet: l.wallet, Stale: true}
			return nil
		}
		level := measured(order.FuelML, stored)
		room := order.CapacityML - level
		add := order.AddML
		if add <= 0 || add > room {
			add = room
		}
		if add <= 0 {
			return ErrTankFull
		}
		cost := FuelCost(add, settings.CityFuel.PricePerLiter)
		if cost > 0 {
			note := order.KartKey + " +" + strconv.FormatInt(add, 10) + "ml"
			applied, err := l.add(economy.Lucci, -cost, ReasonCityFuel, order.RequestID, note)
			if err != nil {
				return err
			}
			if !applied { // the requestId paid for another refill: change nothing
				charge = FuelCharge{FuelML: stored.FuelML, Rev: stored.Rev, Wallet: l.wallet, Stale: true}
				return nil
			}
		}
		charge = FuelCharge{FuelML: level + add, Rev: order.Rev + 1, AddedML: add, Cost: cost, Wallet: l.wallet}
		return writeFuel(ctx, tx, order.tankAccount(), order.KartKey, charge.FuelML, charge.Rev, now)
	})
	return charge, err
}

// RescueKart pays the tow of a stalled kart (FUEL.md 4.3): the admin's
// rescue fee in 金币 (ledger reason "cityrescue", ref requestId), free
// when the wallet holds less, and stores the measured level.
func (s *Store) RescueKart(ctx context.Context, order FuelOrder, now int64) (FuelCharge, error) {
	var charge FuelCharge
	err := inEconomyTx(ctx, s.db, nil, func(tx *sql.Tx) error {
		charge = FuelCharge{}
		settings, err := s.economySettings(ctx, tx)
		if err != nil {
			return err
		}
		if !settings.CityFuel.Enabled {
			return ErrCityFuelOff
		}
		l, err := s.lockLedger(ctx, tx, order.AccountID, now)
		if err != nil {
			return err
		}
		stored, err := lockFuel(ctx, tx, order.tankAccount(), order.KartKey, order.CapacityML, now)
		if err != nil {
			return err
		}
		if stored.Rev != order.Rev {
			charge = FuelCharge{FuelML: stored.FuelML, Rev: stored.Rev, Wallet: l.wallet, Stale: true}
			return nil
		}
		fee, free := settings.CityFuel.RescueFee, false
		if fee > l.wallet.Lucci {
			fee, free = 0, true
		}
		if fee > 0 {
			applied, err := l.add(economy.Lucci, -fee, ReasonCityRescue, order.RequestID, order.KartKey)
			if err != nil {
				return err
			}
			if !applied {
				charge = FuelCharge{FuelML: stored.FuelML, Rev: stored.Rev, Wallet: l.wallet, Stale: true}
				return nil
			}
		}
		charge = FuelCharge{FuelML: measured(order.FuelML, stored), Rev: order.Rev + 1, Cost: fee, Wallet: l.wallet, Free: free}
		return writeFuel(ctx, tx, order.tankAccount(), order.KartKey, charge.FuelML, charge.Rev, now)
	})
	return charge, err
}
