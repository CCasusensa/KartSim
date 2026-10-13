// Package datatest holds helpers shared by the data service tests. MySQL
// tests run only when KART_TEST_MYSQL_DSN is set; they share one database,
// so every test uses unique ids and deletes what it created.
package datatest

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	"kartsim/internal/data/store"
)

// MySQL opens the test database with the current schema, or skips the test
// when KART_TEST_MYSQL_DSN is unset.
func MySQL(t testing.TB) *sql.DB {
	t.Helper()
	dsn := os.Getenv("KART_TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("KART_TEST_MYSQL_DSN is not set")
	}
	db, err := store.Open(dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if err := store.WaitReady(ctx, db, 10*time.Second, Logger()); err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(ctx, db, Logger()); err != nil {
		t.Fatal(err)
	}
	return db
}

// Logger discards log output.
func Logger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// Unique returns a short random hex string for test ids and names.
func Unique() string {
	value := make([]byte, 5)
	if _, err := rand.Read(value); err != nil {
		panic(err)
	}
	return hex.EncodeToString(value)
}

// Exec runs cleanup or fixture SQL and fails the test on error.
func Exec(t testing.TB, db *sql.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.ExecContext(context.Background(), query, args...); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
}

// LockEconomySettings serializes the tests that change the shared
// app_settings "economy" row (the admin's grants and the city fuel prices)
// across test packages, which `go test ./...` runs in parallel: it takes a
// MySQL advisory lock on its own connection and releases it after the
// test's other cleanups. Call it before registering cleanups that restore
// the row.
func LockEconomySettings(t testing.TB, db *sql.DB) {
	t.Helper()
	ctx := context.Background()
	conn, err := db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var got sql.NullInt64
	if err := conn.QueryRowContext(ctx, "SELECT GET_LOCK('kartsim_test_economy_settings', 120)").Scan(&got); err != nil || got.Int64 != 1 {
		conn.Close()
		t.Fatalf("economy settings test lock: %v (%v)", got, err)
	}
	t.Cleanup(func() {
		conn.ExecContext(ctx, "DO RELEASE_LOCK('kartsim_test_economy_settings')")
		conn.Close()
	})
}
