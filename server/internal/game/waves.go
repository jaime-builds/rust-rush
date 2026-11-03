// Wave definitions: what each wave spawns and how enemy stats scale.

package game

import (
	"math"
)

// WaveEnemy defines one enemy entry in a wave definition
type WaveEnemy struct {
	EnemyType  string
	Count      int
	SpawnDelay float64
}

// WaveConfig defines what enemies spawn in a given wave
type WaveConfig struct {
	Wave    int
	Enemies []WaveEnemy
}

// GetWaveConfig returns the enemy configuration for a given wave number
func GetWaveConfig(wave int) WaveConfig {
	switch {
	case wave <= 3:
		count := 5 + (wave-1)*2
		delay := 2.0 - float64(wave-1)*0.2
		return WaveConfig{Wave: wave, Enemies: []WaveEnemy{
			{EnemyType: "basic", Count: count, SpawnDelay: delay},
		}}
	case wave <= 6:
		basicCount := 6 + (wave-4)*2
		fastCount := 2 + (wave - 4)
		delay := 1.5 - float64(wave-4)*0.1
		return WaveConfig{Wave: wave, Enemies: []WaveEnemy{
			{EnemyType: "basic", Count: basicCount, SpawnDelay: delay},
			{EnemyType: "fast", Count: fastCount, SpawnDelay: delay * 0.7},
		}}
	case wave <= 10:
		basicCount := 8 + (wave-7)*2
		fastCount := 3 + (wave - 7)
		tankCount := 1 + (wave-7)/2
		delay := 1.2 - float64(wave-7)*0.05
		return WaveConfig{Wave: wave, Enemies: []WaveEnemy{
			{EnemyType: "basic", Count: basicCount, SpawnDelay: delay},
			{EnemyType: "fast", Count: fastCount, SpawnDelay: delay * 0.6},
			{EnemyType: "tank", Count: tankCount, SpawnDelay: delay * 1.5},
		}}
	default:
		// Past wave 10: counts grow faster using a quadratic bump on top of linear.
		extra := wave - 10

		basicCount := 10 + extra*2 + (extra*extra)/8
		fastCount := 3 + extra + (extra*extra)/12
		tankCount := 1 + extra/2 + (extra*extra)/20

		// Boss every 3rd wave from wave 11 onward (was every 5th), capped at 6
		bossCount := 0
		if wave >= 11 {
			bossCount = 1 + (wave-11)/3
			if bossCount > 6 {
				bossCount = 6
			}
		}

		// Spawn delay floors at 0.25s (was 0.4s)
		delay := math.Max(1.0-float64(extra)*0.04, 0.25)

		enemies := []WaveEnemy{
			{EnemyType: "basic", Count: basicCount, SpawnDelay: delay},
			{EnemyType: "fast", Count: fastCount, SpawnDelay: delay * 0.6},
			{EnemyType: "tank", Count: tankCount, SpawnDelay: delay * 1.4},
		}
		if bossCount > 0 {
			bossDelay := math.Max(2.5-float64(extra)*0.05, 1.5)
			enemies = append(enemies, WaveEnemy{EnemyType: "boss", Count: bossCount, SpawnDelay: bossDelay})
		}
		return WaveConfig{Wave: wave, Enemies: enemies}
	}
}

// ScaledEnemyStats returns health and speed for an enemy type scaled to the current wave.
// Base stats are unchanged so the info panel still shows correct base values.
//
// Health: +10% compound per wave above 5.
// Speed:  +3% compound per wave above 5, capped at +80% of base.
func ScaledEnemyStats(enemyType string, wave int) (health float64, speed float64) {
	base := getEnemyStats(enemyType)

	// Health scaling starts at wave 5 so early waves feel fair.
	// +10% compound per wave above 5 (was +15% from wave 1 — too steep).
	healthWaves := math.Max(0, float64(wave-5))
	healthMult := math.Pow(1.10, healthWaves)
	health = base.Health * healthMult

	speedMult := 1.0
	if wave > 5 {
		speedMult = math.Min(math.Pow(1.03, float64(wave-5)), 1.80)
	}
	speed = base.Speed * speedMult

	return health, speed
}
