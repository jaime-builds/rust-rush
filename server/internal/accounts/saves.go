package accounts

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"rust-rush/server/internal/game"
)

// The accounts store is the game's SaveStore: one row per account in saves,
// replaced on every write.

// SaveRun stores (or replaces) the account's saved run.
func (s *Store) SaveRun(userID int64, run game.SavedRun) error {
	data, err := json.Marshal(run)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`
		INSERT INTO saves (user_id, state, map_id, wave, updated_at) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, map_id = excluded.map_id,
			wave = excluded.wave, updated_at = excluded.updated_at`,
		userID, string(data), run.MapID, run.Wave, s.stamp(time.Now()))
	return err
}

// LoadRun returns the account's saved run, if any.
func (s *Store) LoadRun(userID int64) (game.SavedRun, bool, error) {
	var data string
	err := s.db.QueryRow(`SELECT state FROM saves WHERE user_id = ?`, userID).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return game.SavedRun{}, false, nil
	}
	if err != nil {
		return game.SavedRun{}, false, err
	}
	var run game.SavedRun
	if err := json.Unmarshal([]byte(data), &run); err != nil {
		return game.SavedRun{}, false, err
	}
	return run, true, nil
}

// DeleteRun drops the account's saved run.
func (s *Store) DeleteRun(userID int64) error {
	_, err := s.db.Exec(`DELETE FROM saves WHERE user_id = ?`, userID)
	return err
}
