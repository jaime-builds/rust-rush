package stats

import (
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "stats.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestOpenCreatesParentDirs(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "dir", "stats.db")
	s, err := Open(path)
	if err != nil {
		t.Fatalf("Open with missing parent dirs: %v", err)
	}
	s.Close()
}

func TestRecordAndQuery(t *testing.T) {
	s := openTestStore(t)

	games := []GameRecord{
		{EndedAt: time.Date(2026, 7, 14, 1, 0, 0, 0, time.UTC), Wave: 5, Score: 1200, Duration: 300.5},
		{EndedAt: time.Date(2026, 7, 14, 2, 0, 0, 0, time.UTC), Wave: 22, Score: 98000, Duration: 2400},
		{EndedAt: time.Date(2026, 7, 14, 3, 0, 0, 0, time.UTC), Wave: 5, Score: 900, Duration: 280},
		{EndedAt: time.Date(2026, 7, 14, 4, 0, 0, 0, time.UTC), Wave: 13, Score: 30000, Duration: 1500},
	}
	for _, g := range games {
		if err := s.RecordGame(g); err != nil {
			t.Fatalf("RecordGame(%+v): %v", g, err)
		}
	}

	total, err := s.TotalGames()
	if err != nil || total != 4 {
		t.Errorf("TotalGames = %d, %v; want 4, nil", total, err)
	}

	dist, err := s.WaveDistribution()
	if err != nil {
		t.Fatalf("WaveDistribution: %v", err)
	}
	want := []WaveCount{{Wave: 5, Count: 2}, {Wave: 13, Count: 1}, {Wave: 22, Count: 1}}
	if len(dist) != len(want) {
		t.Fatalf("distribution = %+v, want %+v", dist, want)
	}
	for i := range want {
		if dist[i] != want[i] {
			t.Errorf("distribution[%d] = %+v, want %+v", i, dist[i], want[i])
		}
	}

	top, err := s.TopScores(2)
	if err != nil {
		t.Fatalf("TopScores: %v", err)
	}
	if len(top) != 2 || top[0].Score != 98000 || top[1].Score != 30000 {
		t.Errorf("TopScores(2) = %+v, want scores [98000 30000]", top)
	}
	if top[0].Wave != 22 || !top[0].EndedAt.Equal(games[1].EndedAt) {
		t.Errorf("top record fields = %+v, want wave 22 at %s", top[0], games[1].EndedAt)
	}
}

func TestHandlerJSON(t *testing.T) {
	s := openTestStore(t)
	if err := s.RecordGame(GameRecord{EndedAt: time.Now(), Wave: 8, Score: 4200, Duration: 611}); err != nil {
		t.Fatalf("RecordGame: %v", err)
	}

	h := Handler(s, func() int { return 3 })
	rr := httptest.NewRecorder()
	h(rr, httptest.NewRequest("GET", "/stats", nil))

	if rr.Code != 200 {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}

	var resp struct {
		ConcurrentPlayers int          `json:"concurrent_players"`
		TotalGames        int          `json:"total_games"`
		WaveDistribution  []WaveCount  `json:"wave_distribution"`
		TopScores         []GameRecord `json:"top_scores"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("response is not valid JSON: %v\n%s", err, rr.Body.String())
	}
	if resp.ConcurrentPlayers != 3 {
		t.Errorf("concurrent_players = %d, want 3", resp.ConcurrentPlayers)
	}
	if resp.TotalGames != 1 {
		t.Errorf("total_games = %d, want 1", resp.TotalGames)
	}
	if len(resp.WaveDistribution) != 1 || resp.WaveDistribution[0] != (WaveCount{Wave: 8, Count: 1}) {
		t.Errorf("wave_distribution = %+v", resp.WaveDistribution)
	}
	if len(resp.TopScores) != 1 || resp.TopScores[0].Score != 4200 {
		t.Errorf("top_scores = %+v", resp.TopScores)
	}
}
