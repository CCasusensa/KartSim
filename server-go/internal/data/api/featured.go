package api

import (
	"net/http"
	"strconv"
	"strings"

	"kartsim/internal/data/store"
	"kartsim/internal/shared/apierr"
)

// 联赛回放 (TIMEATTACK.md 4): the admin publishes ranked replays with a
// title; riders list and download them from the 回放 tab's 联赛回放 page.

var errInvalidFeatured = apierr.New(http.StatusBadRequest, "INVALID_FEATURED")

const (
	maxFeaturedTitle = 60
	maxFeaturedNote  = 200
)

// listFeaturedReplays answers the published replays, newest first.
func (a *API) listFeaturedReplays(w http.ResponseWriter, r *http.Request) error {
	if _, err := a.signedIn(r); err != nil {
		return err
	}
	replays, err := a.featuredList(r)
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"replays": replays})
}

func (a *API) featuredList(r *http.Request) ([]store.FeaturedReplay, error) {
	replays, err := a.store.FeaturedReplays(r.Context())
	for i := range replays {
		replays[i].TrackName = a.trackName(replays[i].TrackID)
	}
	return replays, err
}

// featuredReplayFile serves a published replay's .ksv.
func (a *API) featuredReplayFile(w http.ResponseWriter, r *http.Request) error {
	if _, err := a.signedIn(r); err != nil {
		return err
	}
	id, err := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
	if err != nil || id <= 0 {
		return errInvalidRequest
	}
	ksv, createdAt, err := a.store.FeaturedReplayFile(r.Context(), id)
	if err != nil {
		return err
	}
	etag := `"featured-` + strconv.FormatInt(id, 10) + "-" + strconv.FormatInt(createdAt, 10) + `"`
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, max-age=300")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return nil
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(len(ksv)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(ksv)
	return nil
}

/* ---------- 管理后台 ---------- */

func (a *API) adminFeaturedReplays(w http.ResponseWriter, r *http.Request) error {
	if _, err := a.requireAdmin(r); err != nil {
		return err
	}
	replays, err := a.featuredList(r)
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"replays": replays})
}

// adminAddFeaturedReplay publishes a ranked replay: {trackId, speed, booster,
// accountId, title, note?}.
func (a *API) adminAddFeaturedReplay(w http.ResponseWriter, r *http.Request) error {
	var request struct {
		TrackID   string `json:"trackId"`
		Speed     int    `json:"speed"`
		Booster   int    `json:"booster"`
		AccountID string `json:"accountId"`
		Title     string `json:"title"`
		Note      string `json:"note"`
	}
	if err := decodeJSON(w, r, &request); err != nil {
		return err
	}
	admin, err := a.requireAdmin(r)
	if err != nil {
		return err
	}
	key, err := a.timeAttackKey(request.TrackID, request.Speed, request.Booster)
	if err != nil {
		return err
	}
	request.Title, request.Note = strings.TrimSpace(request.Title), strings.TrimSpace(request.Note)
	if !validText(request.Title, maxFeaturedTitle) || !optionalText(request.Note, maxFeaturedNote) ||
		!validText(request.AccountID, 36) {
		return errInvalidFeatured
	}
	replay, err := a.store.AddFeaturedReplay(r.Context(), store.RankedKey(key.TrackID, key.Speed, key.Booster),
		request.AccountID, request.Title, request.Note, admin.Username, a.nowMillis())
	if err != nil {
		return err
	}
	replay.TrackName = a.trackName(replay.TrackID)
	a.log.Info("featured replay published", "admin", admin.Username, "id", replay.ID, "track", replay.TrackID,
		"rider", replay.Nickname)
	return writeJSON(w, http.StatusOK, map[string]any{"replay": replay})
}

func (a *API) adminDeleteFeaturedReplay(w http.ResponseWriter, r *http.Request) error {
	admin, err := a.requireAdmin(r)
	if err != nil {
		return err
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		return errInvalidRequest
	}
	if err := a.store.DeleteFeaturedReplay(r.Context(), id); err != nil {
		return err
	}
	a.log.Info("featured replay removed", "admin", admin.Username, "id", id)
	return writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// adminTimeAttackReplays lists the stored ranked replays (the pool the admin
// publishes from): q matches the username, nickname and track id; filters
// track and account.
func (a *API) adminTimeAttackReplays(w http.ResponseWriter, r *http.Request) error {
	if _, err := a.requireAdmin(r); err != nil {
		return err
	}
	list, err := parseAdminList(r, false, "updatedAt", "bestMs", "track")
	if err != nil {
		return err
	}
	var filter store.ReplayFilter
	if track := strings.TrimSpace(r.URL.Query().Get("track")); track != "" {
		if !validText(track, 64) {
			return errInvalidQuery
		}
		filter.TrackID = track
	}
	var matched bool
	if filter.AccountID, matched, err = a.accountParam(r.Context(), r); err != nil {
		return err
	} else if !matched {
		return emptyList[store.AdminReplayRow](w, list)
	}
	rows, total, err := a.store.AdminTimeAttackReplays(r.Context(), list.AdminPage, filter)
	if err != nil {
		return err
	}
	for i := range rows {
		rows[i].TrackName = a.trackName(rows[i].TrackID)
	}
	return answerList(w, list, rows, total)
}
