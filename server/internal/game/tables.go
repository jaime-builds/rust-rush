// Stat tables and lookups for towers, enemies and wave previews.

package game

import (
	"math/rand"
)

// Helper types and functions

// Slow and splash tower defaults — the single source for AddTower
// initialization, the projectile-hit fallbacks, and the upgrade formulas.
const (
	defaultSlowDuration   = 2.0
	defaultSlowMultiplier = 0.40
	defaultAOERadius      = 1.5
	defaultAOEDamagePct   = 0.60
	// Tesla chain lightning: level 1 arcs to 2 extra enemies within 1.5u;
	// count and radius both grow per level (Tesla's identity is multi-target,
	// so its upgrades widen the chain instead of only raising damage).
	defaultChainCount   = 2
	defaultChainRadius  = 1.5
	teslaChainDamagePct = 0.5
)

// rootRoll is math/rand behind a var so deep-freeze tests can pin the dice.
var rootRoll = rand.Float64

type towerStats struct {
	Range    float64
	Damage   float64
	FireRate float64
}

// Stat tables are package-level so lookups don't rebuild a map per call.
// Values are mirrored in the client UI (client/src/types/game.ts TOWER_COSTS,
// GameCanvas.tsx TOWER_RANGES and ENEMY_GLOSSARY) — keep them in sync.
var (
	towerStatsByType = map[string]towerStats{
		"basic":  {Range: 3.0, Damage: 15.0, FireRate: 1.0},
		"sniper": {Range: 6.0, Damage: 50.0, FireRate: 0.5},
		"splash": {Range: 2.5, Damage: 10.0, FireRate: 1.5},
		"slow":   {Range: 3.5, Damage: 8.0, FireRate: 0.8},
		"tesla":  {Range: 4.0, Damage: 20.0, FireRate: 0.8},
	}
	towerCostByType = map[string]int{
		"basic":  50,
		"sniper": 100,
		"splash": 75,
		"slow":   60,
		"tesla":  150,
	}
	enemyStatsByType = map[string]enemyStats{
		"basic":  {Health: 100.0, Speed: 2.0},
		"fast":   {Health: 50.0, Speed: 4.0},
		"tank":   {Health: 300.0, Speed: 1.0},
		"flying": {Health: 80.0, Speed: 3.0}, // defined but never spawned by any wave
		"boss":   {Health: 1000.0, Speed: 0.5},
	}
)

func getTowerStats(towerType string) towerStats {
	if s, ok := towerStatsByType[towerType]; ok {
		return s
	}
	return towerStatsByType["basic"]
}

func getTowerCost(towerType string) int {
	if c, ok := towerCostByType[towerType]; ok {
		return c
	}
	return 50
}

type enemyStats struct {
	Health float64
	Speed  float64
}

func getEnemyStats(enemyType string) enemyStats {
	if s, ok := enemyStatsByType[enemyType]; ok {
		return s
	}
	return enemyStatsByType["basic"]
}

// buildWavePreview flattens the wave config into {enemy_type, count} entries for the client
func buildWavePreview(wave int) []WavePreviewEntry {
	config := GetWaveConfig(wave)
	preview := make([]WavePreviewEntry, 0, len(config.Enemies))
	for _, group := range config.Enemies {
		preview = append(preview, WavePreviewEntry{EnemyType: group.EnemyType, Count: group.Count})
	}
	return preview
}

// Score points per kill (multiplied by the enemy's spawn wave when awarded)
// and gold rewards. Values differ on purpose: score rewards difficulty (fast
// enemies are hard to hit), gold rewards farming.
var (
	enemyScoreByType = map[string]int{
		"basic":  10,
		"fast":   15,
		"tank":   30,
		"flying": 20,
		"boss":   100,
	}
	enemyGoldByType = map[string]int{
		"basic":  10,
		"fast":   8,
		"tank":   25,
		"flying": 15,
		"boss":   100,
	}
)

func getEnemyScorePoints(enemyType string) int {
	if p, ok := enemyScoreByType[enemyType]; ok {
		return p
	}
	return 10
}

func getEnemyGoldReward(enemyType string) int {
	if r, ok := enemyGoldByType[enemyType]; ok {
		return r
	}
	return 10
}
