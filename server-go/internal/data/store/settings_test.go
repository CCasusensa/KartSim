package store_test

import (
	"context"
	"testing"

	"kartsim/internal/data/datatest"
	"kartsim/internal/data/store"
)

// The admin-set grants (ECONOMY.md 2.3/2.4): defaults until saved, then
// the saved amounts; a new wallet receives the registration grant and a
// finished race the per-race grant (outside the daily caps, reason
// "racebonus"), while an unfinished racer gets only the formula reward.
func TestEconomySettingsAndGrants(t *testing.T) {
	db := datatest.MySQL(t)
	st := store.New(db)
	ctx := context.Background()
	u := datatest.Unique()
	datatest.Exec(t, db, "DELETE FROM app_settings WHERE name = 'economy'")
	t.Cleanup(func() { datatest.Exec(t, db, "DELETE FROM app_settings WHERE name = 'economy'") })

	settings, err := st.EconomySettings(ctx)
	if err != nil || settings != st.DefaultEconomySettings() ||
		settings.Register != (store.CurrencyGrant{Coupon: 20_000, Lucci: 20_000, Koin: 20_000}) ||
		settings.Race != (store.CurrencyGrant{Coupon: 100}) {
		t.Fatalf("defaults %+v, %v", settings, err)
	}
	if _, err := st.SaveEconomySettings(ctx, store.EconomySettings{Register: store.CurrencyGrant{Coupon: -1}}, "admin", 1); err == nil {
		t.Fatal("a negative grant was accepted")
	}
	saved, err := st.SaveEconomySettings(ctx, store.EconomySettings{
		Register: store.CurrencyGrant{Coupon: 1, Lucci: 2, Koin: 3}, Race: store.CurrencyGrant{Coupon: 4, Lucci: 5, Koin: 6},
	}, "chief", 1234)
	if err != nil || saved.Register != (store.CurrencyGrant{Coupon: 1, Lucci: 2, Koin: 3}) ||
		saved.Race != (store.CurrencyGrant{Coupon: 4, Lucci: 5, Koin: 6}) || saved.UpdatedAt != 1234 || saved.UpdatedBy != "chief" {
		t.Fatalf("saved %+v, %v", saved, err)
	}

	ids := make([]string, 2)
	for i := range ids {
		ids[i] = "00000000-0000-4000-8000-" + u + "e" + string(rune('0'+i))
		datatest.Exec(t, db, `INSERT INTO accounts(id, username, nickname, password_hash, admin, created_at)
			VALUES(?, ?, ?, 'x', 0, 0)`, ids[i], "econ_"+u+string(rune('0'+i)), "Econ"+u+string(rune('0'+i)))
	}
	t.Cleanup(func() {
		datatest.Exec(t, db, "DELETE FROM accounts WHERE id IN (?, ?)", ids[0], ids[1])
		datatest.Exec(t, db, "DELETE FROM race_outcomes WHERE race_id = ?", "econ-"+u)
	})
	elapsed := 90_000
	_, credited, err := st.SaveSettlement(ctx, store.Settlement{RaceID: "econ-" + u, RoomID: "room-" + u,
		Gameplay: "ordinary", TrackID: "forest_I01", Snapshot: "{}", CreatedAt: 5000, RewardDay: "2026-10-11",
		Results: []store.SettledResult{
			{PlayerID: "p0", AccountID: ids[0], Name: "a", Rank: 1, ElapsedMs: &elapsed},
			{PlayerID: "p1", AccountID: ids[1], Name: "b", Rank: 2}},
		Rewards: []store.SettledReward{
			{AccountID: ids[0], Exp: 10, Lucci: 20, Finished: true},
			{AccountID: ids[1], Exp: 10, Lucci: 10}}})
	if err != nil || len(credited) != 2 {
		t.Fatalf("settlement %+v, %v", credited, err)
	}
	// Registration grant 1/2/3, then the race: the finisher gets 20 + 5 lucci,
	// 4 coupons and 6 koin on top; the other only its 10 lucci.
	if credited[0].AccountID != ids[0] || credited[0].Lucci != 25 || credited[0].Coupon != 4 || credited[0].Koin != 6 ||
		credited[1].AccountID != ids[1] || credited[1].Lucci != 10 || credited[1].Coupon != 0 || credited[1].Koin != 0 {
		t.Fatalf("credited %+v", credited)
	}
	var coupon, lucci, koin int64
	if err := db.QueryRowContext(ctx, "SELECT coupon, lucci, koin FROM wallets WHERE account_id = ?", ids[0]).Scan(&coupon, &lucci, &koin); err != nil {
		t.Fatal(err)
	}
	if coupon != 5 || lucci != 27 || koin != 9 {
		t.Fatalf("finisher wallet %d/%d/%d", coupon, lucci, koin)
	}
	if err := db.QueryRowContext(ctx, "SELECT coupon, lucci, koin FROM wallets WHERE account_id = ?", ids[1]).Scan(&coupon, &lucci, &koin); err != nil {
		t.Fatal(err)
	}
	if coupon != 1 || lucci != 12 || koin != 3 {
		t.Fatalf("retired racer wallet %d/%d/%d", coupon, lucci, koin)
	}
	var bonusRows, starterRows int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM wallet_ledger WHERE account_id = ? AND reason = 'racebonus' AND ref_id = ?",
		ids[0], "econ-"+u).Scan(&bonusRows); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM wallet_ledger WHERE account_id = ? AND reason = 'starter' AND ref_id = 'signup'",
		ids[1]).Scan(&starterRows); err != nil {
		t.Fatal(err)
	}
	if bonusRows != 3 || starterRows != 3 {
		t.Fatalf("ledger rows: %d racebonus, %d starter", bonusRows, starterRows)
	}
}
