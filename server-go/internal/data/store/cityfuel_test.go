package store_test

import (
	"context"
	"errors"
	"testing"

	"kartsim/internal/data/datatest"
	"kartsim/internal/data/store"
	"kartsim/internal/shared/apierr"
)

func fuelAccount(t *testing.T, st *store.Store, suffix string) (string, context.Context) {
	t.Helper()
	db := st.DB()
	id := "00000000-0000-4000-8000-" + suffix
	datatest.Exec(t, db, `INSERT INTO accounts(id, username, nickname, password_hash, admin, created_at)
		VALUES(?, ?, ?, 'x', 0, 0)`, id, "fuel_"+suffix, "Fuel"+suffix)
	t.Cleanup(func() { datatest.Exec(t, db, "DELETE FROM accounts WHERE id = ?", id) })
	return id, context.Background()
}

func lucciOf(t *testing.T, st *store.Store, ctx context.Context, account string) int64 {
	t.Helper()
	lucci, err := st.Lucci(ctx, account, 1)
	if err != nil {
		t.Fatal(err)
	}
	return lucci
}

// A kart arrives with a full tank; saves apply once per revision and only
// lower the level; a refill charges ceil(ml × price / 1000) 金币 and a
// retried refill changes nothing (FUEL.md 3–4).
func TestCityFuelTankSaveAndRefuel(t *testing.T) {
	db := datatest.MySQL(t)
	datatest.LockEconomySettings(t, db)
	st := newGrantlessStore(db)
	datatest.Exec(t, db, "DELETE FROM app_settings WHERE name = 'economy'")
	t.Cleanup(func() { datatest.Exec(t, db, "DELETE FROM app_settings WHERE name = 'economy'") })
	u := datatest.Unique()
	account, ctx := fuelAccount(t, st, u+"f0")
	const kart, capacity = "item:1020", 40_000

	tank, err := st.FuelTank(ctx, account, kart, capacity)
	if err != nil || tank != (store.FuelTank{FuelML: capacity}) {
		t.Fatalf("new tank %+v, %v", tank, err)
	}
	saved, applied, err := st.SaveFuel(ctx, account, kart, capacity, 30_000, 0, 10)
	if err != nil || !applied || saved != (store.FuelTank{FuelML: 30_000, Rev: 1}) {
		t.Fatalf("save %+v %v, %v", saved, applied, err)
	}
	// A late save of the old revision changes nothing; a save never raises the level.
	if again, applied, err := st.SaveFuel(ctx, account, kart, capacity, 35_000, 0, 11); err != nil || applied || again != saved {
		t.Fatalf("stale save %+v %v, %v", again, applied, err)
	}
	if raised, _, err := st.SaveFuel(ctx, account, kart, capacity, 39_000, 1, 12); err != nil || raised.FuelML != 30_000 || raised.Rev != 2 {
		t.Fatalf("raising save %+v, %v", raised, err)
	}

	before := lucciOf(t, st, ctx, account) // creates the wallet with the starting lucci
	if before != store.DefaultStartingLucci {
		t.Fatalf("starting lucci %d", before)
	}
	charge, err := st.Refuel(ctx, store.FuelOrder{AccountID: account, KartKey: kart, RequestID: "r1",
		CapacityML: capacity, FuelML: 25_500, Rev: 2, AddML: 4_001}, 20)
	// 4.001 L at 5 金币/L = 20.005 → 21 金币.
	if err != nil || charge.Stale || charge.AddedML != 4_001 || charge.Cost != 21 || charge.FuelML != 29_501 || charge.Rev != 3 ||
		charge.Wallet.Lucci != before-21 {
		t.Fatalf("refuel %+v (lucci before %d), %v", charge, before, err)
	}
	// The same call again (a retry after a lost answer) is stale and free.
	if retry, err := st.Refuel(ctx, store.FuelOrder{AccountID: account, KartKey: kart, RequestID: "r1",
		CapacityML: capacity, FuelML: 25_500, Rev: 2, AddML: 4_001}, 21); err != nil || !retry.Stale || retry.FuelML != 29_501 ||
		retry.Wallet.Lucci != before-21 {
		t.Fatalf("retried refuel %+v, %v", retry, err)
	}
	// AddML 0 fills up: 10.499 L → 53 金币.
	full, err := st.Refuel(ctx, store.FuelOrder{AccountID: account, KartKey: kart, RequestID: "r2",
		CapacityML: capacity, FuelML: 29_501, Rev: 3}, 22)
	if err != nil || full.FuelML != capacity || full.AddedML != 10_499 || full.Cost != 53 || full.Rev != 4 {
		t.Fatalf("fill up %+v, %v", full, err)
	}
	if _, err := st.Refuel(ctx, store.FuelOrder{AccountID: account, KartKey: kart, RequestID: "r3",
		CapacityML: capacity, FuelML: capacity, Rev: 4}, 23); !errors.Is(err, store.ErrTankFull) {
		t.Fatalf("full tank refuel: %v", err)
	}
	if tank, err := st.FuelTank(ctx, account, kart, capacity); err != nil || tank != (store.FuelTank{FuelML: capacity, Rev: 4}) {
		t.Fatalf("stored tank %+v, %v", tank, err)
	}
	// A smaller table capacity caps the stored level.
	if tank, err := st.FuelTank(ctx, account, kart, 30_000); err != nil || tank.FuelML != 30_000 {
		t.Fatalf("capped tank %+v, %v", tank, err)
	}
}

// Refills need the 金币; a rescue charges the fee or is free when the
// wallet holds less; fuel switched off refuses both.
func TestCityFuelFundsRescueAndSwitch(t *testing.T) {
	db := datatest.MySQL(t)
	datatest.LockEconomySettings(t, db)
	st := newGrantlessStore(db)
	datatest.Exec(t, db, "DELETE FROM app_settings WHERE name = 'economy'")
	t.Cleanup(func() { datatest.Exec(t, db, "DELETE FROM app_settings WHERE name = 'economy'") })
	u := datatest.Unique()
	account, ctx := fuelAccount(t, st, u+"f1")
	const kart, capacity = "system:practiceKart", 60_000

	settings := st.DefaultEconomySettings()
	settings.CityFuel.PricePerLiter = 1_000
	if _, err := st.SaveEconomySettings(ctx, settings, "admin", 1); err != nil {
		t.Fatal(err)
	}
	// 20,000 starting lucci buy 20 L at 1,000/L; 21 L is too much.
	if _, err := st.Refuel(ctx, store.FuelOrder{AccountID: account, KartKey: kart, RequestID: "a",
		CapacityML: capacity, FuelML: 0, Rev: 0, AddML: 21_000}, 5); !isCode(err, "INSUFFICIENT_FUNDS") {
		t.Fatalf("unaffordable refuel: %v", err)
	}
	charge, err := st.Refuel(ctx, store.FuelOrder{AccountID: account, KartKey: kart, RequestID: "b",
		CapacityML: capacity, FuelML: 0, Rev: 0, AddML: 20_000}, 6)
	if err != nil || charge.Cost != 20_000 || charge.Wallet.Lucci != 0 || charge.FuelML != 20_000 || charge.Rev != 1 {
		t.Fatalf("refuel %+v, %v", charge, err)
	}
	// Broke: the tow is free and stores the measured level.
	rescue, err := st.RescueKart(ctx, store.FuelOrder{AccountID: account, KartKey: kart, RequestID: "c",
		CapacityML: capacity, FuelML: 0, Rev: 1}, 7)
	if err != nil || !rescue.Free || rescue.Cost != 0 || rescue.FuelML != 0 || rescue.Rev != 2 {
		t.Fatalf("free rescue %+v, %v", rescue, err)
	}
	datatest.Exec(t, db, "UPDATE wallets SET lucci = 500 WHERE account_id = ?", account)
	paid, err := st.RescueKart(ctx, store.FuelOrder{AccountID: account, KartKey: kart, RequestID: "d",
		CapacityML: capacity, FuelML: 0, Rev: 2}, 8)
	if err != nil || paid.Free || paid.Cost != store.DefaultFuelRescueFee || paid.Wallet.Lucci != 500-store.DefaultFuelRescueFee {
		t.Fatalf("paid rescue %+v, %v", paid, err)
	}
	var rows int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM wallet_ledger WHERE account_id = ? AND reason IN (?, ?)`,
		account, store.ReasonCityFuel, store.ReasonCityRescue).Scan(&rows); err != nil || rows != 2 {
		t.Fatalf("ledger rows %d, %v", rows, err)
	}

	settings.CityFuel.Enabled = false
	if _, err := st.SaveEconomySettings(ctx, settings, "admin", 2); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Refuel(ctx, store.FuelOrder{AccountID: account, KartKey: kart, RequestID: "e",
		CapacityML: capacity, FuelML: 0, Rev: 3}, 9); !errors.Is(err, store.ErrCityFuelOff) {
		t.Fatalf("refuel while off: %v", err)
	}
	if _, err := st.RescueKart(ctx, store.FuelOrder{AccountID: account, KartKey: kart, RequestID: "f",
		CapacityML: capacity, FuelML: 0, Rev: 3}, 9); !errors.Is(err, store.ErrCityFuelOff) {
		t.Fatalf("rescue while off: %v", err)
	}
}

func TestFuelCost(t *testing.T) {
	for _, c := range []struct{ ml, price, cost int64 }{{0, 5, 0}, {1, 5, 1}, {1000, 5, 5}, {1001, 5, 6}, {40_000, 5, 200}, {5_000, 0, 0}} {
		if got := store.FuelCost(c.ml, c.price); got != c.cost {
			t.Errorf("FuelCost(%d, %d) = %d, want %d", c.ml, c.price, got, c.cost)
		}
	}
}

func isCode(err error, code string) bool {
	rejected, ok := apierr.As(err)
	return ok && rejected.Code == code
}
