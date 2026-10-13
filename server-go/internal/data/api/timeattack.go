package api

import (
	"encoding/base64"
	"net/http"
	"strconv"

	"kartsim/internal/data/store"
	"kartsim/internal/data/timeattack"
	"kartsim/internal/shared/apierr"
)

// 练习计时赛 / 排位计时赛 (TIMEATTACK.md): the track ranking, the ranked entry
// fee and replays, the training goals and the 赛道对决.

var (
	errInvalidSpeedMode = apierr.New(http.StatusBadRequest, "INVALID_SPEED_MODE")
	errInvalidReplay    = apierr.New(http.StatusBadRequest, "INVALID_REPLAY")
	errInvalidGoal      = apierr.New(http.StatusBadRequest, "INVALID_GOAL")
	errNoDuel           = apierr.New(http.StatusNotFound, "DUEL_NOT_ACTIVE")
	errInvalidDuel      = apierr.New(http.StatusBadRequest, "INVALID_DUEL")
)

// timeAttackKey reads trackId, speed and booster from a query or a body.
func (a *API) timeAttackKey(trackID string, speed, booster int) (store.Ranking, error) {
	if !validText(trackID, 64) || !a.tracks.Has(trackID) {
		return store.Ranking{}, errInvalidTrack
	}
	if speed < 0 || speed > 9 || booster < 0 || booster > 1 {
		return store.Ranking{}, errInvalidSpeedMode
	}
	return store.Ranking{TrackID: trackID, Speed: speed, Booster: booster}, nil
}

// optionalText is validText that also accepts "".
func optionalText(value string, max int) bool { return value == "" || validText(value, max) }

func queryInt(r *http.Request, name string, fallback int) int {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return -1
	}
	return value
}

// timeAttackRanking answers GET /api/timeattack/ranking?trackId=&speed=&booster=.
func (a *API) timeAttackRanking(w http.ResponseWriter, r *http.Request) error {
	account, err := a.signedIn(r)
	if err != nil {
		return err
	}
	key, err := a.timeAttackKey(r.URL.Query().Get("trackId"), queryInt(r, "speed", 7), queryInt(r, "booster", 0))
	if err != nil {
		return err
	}
	ranking, err := a.store.TimeAttackRanking(r.Context(), store.RankedKey(key.TrackID, key.Speed, key.Booster), account.ID)
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, ranking)
}

// enterRanked charges the ranked entry fee (POST {requestId, trackId, speed, booster}).
func (a *API) enterRanked(w http.ResponseWriter, r *http.Request) error {
	var request struct {
		RequestID string `json:"requestId"`
		TrackID   string `json:"trackId"`
		Speed     int    `json:"speed"`
		Booster   int    `json:"booster"`
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
	key, err := a.timeAttackKey(request.TrackID, request.Speed, request.Booster)
	if err != nil {
		return err
	}
	if err := a.accountWrite(r.Context(), account.ID); err != nil {
		return err
	}
	if err := a.store.EnterRanked(r.Context(), account.ID, id, store.RankedKey(key.TrackID, key.Speed, key.Booster),
		a.nowMillis()); err != nil {
		return err
	}
	summary, err := a.summary(r, account)
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"requestId": id, "fee": timeattack.RankedEntryLucci,
		"summary": summary})
}

// timeAttackReplay streams a ranked record's replay
// (GET ?trackId=&speed=&booster=&accountId=), a .ksv file.
func (a *API) timeAttackReplay(w http.ResponseWriter, r *http.Request) error {
	if _, err := a.signedIn(r); err != nil {
		return err
	}
	key, err := a.timeAttackKey(r.URL.Query().Get("trackId"), queryInt(r, "speed", 7), queryInt(r, "booster", 0))
	if err != nil {
		return err
	}
	accountID := r.URL.Query().Get("accountId")
	if !validText(accountID, 36) {
		return errInvalidRequest
	}
	ksv, updatedAt, err := a.store.TimeAttackReplay(r.Context(), store.RankedKey(key.TrackID, key.Speed, key.Booster), accountID)
	if err != nil {
		return err
	}
	etag := `"` + key.TrackID + "-" + strconv.Itoa(key.Speed) + strconv.Itoa(key.Booster) + "-" + accountID + "-" +
		strconv.FormatInt(updatedAt, 10) + `"`
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

// duelJSON is the active duel event as the window shows it.
type duelJSON struct {
	Key      string                `json:"key"`
	TrackID  string                `json:"trackId"`
	Track    string                `json:"track"`
	From     int64                 `json:"from"`
	To       int64                 `json:"to"`
	Stages   []duelStageJSON       `json:"stages"`
	Standing []store.DuelStageView `json:"standing"`
}

type duelStageJSON struct {
	timeattack.DuelStage
	TargetMs int64        `json:"targetMs"`
	Rewards  []rewardJSON `json:"rewards"`
}

type rewardJSON struct {
	Type     string `json:"type"`
	Value    int    `json:"value"`
	Name     string `json:"name"`
	Category int    `json:"category,omitempty"`
	ItemID   int    `json:"itemId,omitempty"`
	Count    int    `json:"count,omitempty"`
	Days     int    `json:"days,omitempty"`
}

// rewardsJSON expands a reward into the items the card shows.
func (a *API) rewardsJSON(reward *timeattack.Reward) []rewardJSON {
	if reward == nil {
		return nil
	}
	switch reward.Type {
	case timeattack.RewardLucci:
		return []rewardJSON{{Type: reward.Type, Value: reward.Value, Name: "金币", Count: reward.Value}}
	case timeattack.RewardRP:
		return []rewardJSON{{Type: reward.Type, Value: reward.Value, Name: "RP", Count: reward.Value}}
	case timeattack.RewardEmblem:
		return []rewardJSON{{Type: reward.Type, Value: reward.Value, Name: "徽章", Count: 1}}
	}
	stock, ok := a.missions.Stock(*reward)
	if !ok {
		return nil
	}
	out := make([]rewardJSON, 0, len(stock.Items))
	for _, item := range stock.Items {
		name := a.itemName(item.Category, item.ItemID, "")
		if name == "" {
			name = stock.Name
		}
		out = append(out, rewardJSON{Type: reward.Type, Value: reward.Value, Name: name, Category: item.Category,
			ItemID: item.ItemID, Count: item.Count, Days: item.Days})
	}
	return out
}

func (a *API) duelJSON(duel *timeattack.Duel, standing []store.DuelStageView) *duelJSON {
	if duel == nil {
		return nil
	}
	from, to := duel.Period()
	out := &duelJSON{Key: duel.Key(), TrackID: duel.TrackID, Track: a.trackName(duel.TrackID), From: from, To: to,
		Standing: standing}
	for _, stage := range duel.Stages {
		out.Stages = append(out.Stages, duelStageJSON{DuelStage: stage, TargetMs: a.missions.DuelTargetMs(duel.TrackID, stage.Stage),
			Rewards: a.rewardsJSON(stage.Reward)})
	}
	return out
}

type goalSetJSON struct {
	store.GoalSetView
	Stages []goalStageJSON `json:"stages"`
}

type goalStageJSON struct {
	store.GoalStageView
	Rewards []rewardJSON `json:"rewards"`
}

func (a *API) goalsJSON(views []store.GoalSetView) []goalSetJSON {
	out := make([]goalSetJSON, 0, len(views))
	for _, view := range views {
		set := goalSetJSON{GoalSetView: view}
		for _, stage := range view.Stages {
			set.Stages = append(set.Stages, goalStageJSON{GoalStageView: stage, Rewards: a.rewardsJSON(&stage.Reward)})
		}
		set.GoalSetView.Stages = nil
		out = append(out, set)
	}
	return out
}

// timeAttackMissions answers GET /api/timeattack/missions?trackId=: the
// track's training goals with the account's progress and the active duel
// (the one the ready window shows, whatever track is selected).
func (a *API) timeAttackMissions(w http.ResponseWriter, r *http.Request) error {
	account, err := a.signedIn(r)
	if err != nil {
		return err
	}
	trackID := r.URL.Query().Get("trackId")
	if !validText(trackID, 64) || !a.tracks.Has(trackID) {
		return errInvalidTrack
	}
	return a.missionsAnswer(w, r, account, trackID)
}

func (a *API) missionsAnswer(w http.ResponseWriter, r *http.Request, account store.Account, trackID string) error {
	duel, _ := a.missions.ActiveDuel(a.now())
	goals := a.missions.Goals(trackID)
	view, err := a.store.TimeAttackMissions(r.Context(), account.ID, trackID, goals, duel)
	if err != nil {
		return err
	}
	var duelView store.TimeAttackMissionsView
	if duel != nil && duel.TrackID != trackID {
		if duelView, err = a.store.TimeAttackMissions(r.Context(), account.ID, duel.TrackID, nil, duel); err != nil {
			return err
		}
	} else {
		duelView = view
	}
	return writeJSON(w, http.StatusOK, map[string]any{
		"trackId": trackID, "goals": a.goalsJSON(view.Goals), "duel": a.duelJSON(duel, duelView.Duel),
		"recordGoalMs": a.missions.RecordGoalMs(trackID),
	})
}

// claimTimeAttackGoal files a cleared goal stage's reward
// (POST {requestId, trackId, set, stage}).
func (a *API) claimTimeAttackGoal(w http.ResponseWriter, r *http.Request) error {
	var request struct {
		RequestID string `json:"requestId"`
		TrackID   string `json:"trackId"`
		Set       int    `json:"set"`
		Stage     int    `json:"stage"`
	}
	if err := decodeJSON(w, r, &request); err != nil {
		return err
	}
	account, err := a.signedIn(r)
	if err != nil {
		return err
	}
	if _, err := requestID(request.RequestID); err != nil {
		return err
	}
	if !validText(request.TrackID, 64) || !a.tracks.Has(request.TrackID) {
		return errInvalidTrack
	}
	goals := a.missions.Goals(request.TrackID)
	if request.Set < 0 || request.Set >= len(goals) || request.Stage < 1 || request.Stage > len(goals[request.Set].Stages) {
		return errInvalidGoal
	}
	if err := a.accountWrite(r.Context(), account.ID); err != nil {
		return err
	}
	view, err := a.store.ClaimTimeAttackGoal(r.Context(), account.ID, request.TrackID, a.missions, goals, request.Set,
		request.Stage, a.nowMillis())
	if err != nil {
		return err
	}
	summary, err := a.summary(r, account)
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"goals": a.goalsJSON(view.Goals), "summary": summary})
}

// settleDuel records a finished 赛道对决 race
// (POST {requestId, key, stage, difficulty, elapsedMs, finished}). The data
// service decides the win: a finished run under the stage's NPC time plus
// the difficulty level's advantage.
func (a *API) settleDuel(w http.ResponseWriter, r *http.Request) error {
	var request struct {
		RequestID  string `json:"requestId"`
		Key        string `json:"key"`
		Stage      int    `json:"stage"`
		Difficulty int    `json:"difficulty"`
		ElapsedMs  int64  `json:"elapsedMs"`
		Finished   bool   `json:"finished"`
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
	duel, ok := a.missions.DuelByKey(request.Key)
	if !ok {
		return errInvalidDuel
	}
	if !duel.Active(a.now()) {
		return errNoDuel
	}
	if request.Stage < 1 || request.Stage > len(duel.Stages) || request.Difficulty < 0 ||
		request.Difficulty > timeattack.MaxDifficulty {
		return errInvalidDuel
	}
	if request.Finished && (request.ElapsedMs < store.MinLicenseMs || request.ElapsedMs > maxTimeAttackMs) {
		return errInvalidElapsed
	}
	if err := a.accountWrite(r.Context(), account.ID); err != nil {
		return err
	}
	stage := duel.Stages[request.Stage-1]
	target := a.missions.DuelTargetMs(duel.TrackID, request.Stage) + int64(stage.Difficulties[request.Difficulty].AdvantageMs)
	won := request.Finished && request.ElapsedMs < target
	result, err := a.store.SettleDuel(r.Context(), a.missions, store.DuelRun{AccountID: account.ID, RequestID: id, Duel: duel,
		Stage: request.Stage, Difficulty: request.Difficulty, Won: won, Now: a.nowMillis()})
	if err != nil {
		return err
	}
	a.log.Debug("duel run", "username", account.Username, "track", duel.TrackID, "stage", request.Stage,
		"won", won, "elapsed", request.ElapsedMs, "target", target)
	summary, err := a.summary(r, account)
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, map[string]any{"won": won, "targetMs": target, "result": result,
		"duel": a.duelJSON(duel, result.Stages), "summary": summary})
}

// decodeReplay validates an uploaded .ksv (base64 in the JSON body).
func decodeReplay(encoded string) ([]byte, error) {
	if encoded == "" {
		return nil, nil
	}
	if len(encoded) > timeattack.MaxReplayBytes*4/3+4 {
		return nil, errInvalidReplay
	}
	bytes, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(bytes) == 0 || len(bytes) > timeattack.MaxReplayBytes {
		return nil, errInvalidReplay
	}
	return bytes, nil
}
