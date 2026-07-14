package game

import "errors"

// evolution.go — the Tower Evolution System.
//
// Every base tower at level 4 (MAX) can permanently evolve into one of two
// terminal forms. Evolving costs 2× the tower's current TotalSpent, and that
// cost is ADDED to TotalSpent, so the 70% sell refund needs no special casing.
// Evolution replaces TowerType outright and pulls stats fresh from
// evolvedStatsByType — evolved stats are authored values, not multipliers on
// the old stats. Evolved towers cannot upgrade, evolve again, or revert.
//
// Design source: "Rust-Rush Tower Evolution Design.md" (vault, July 3 2026).

// Evolution failure reasons, distinguished so the client ack can say why.
var (
	ErrNotMaxLevel      = errors.New("tower is not at max level")
	ErrAlreadyEvolved   = errors.New("tower is already evolved")
	ErrInvalidEvolution = errors.New("invalid evolution for this tower type")
)

// evolutionOptions maps each base tower type to its two terminal forms.
// Order matters only for display; both cost the same.
var evolutionOptions = map[string][2]string{
	"basic":  {"breach", "barrage"},
	"sniper": {"piercer", "executioner"},
	"splash": {"cluster", "siege"},
	"slow":   {"cryo_field", "deep_freeze"},
	"tesla":  {"laser", "amplifier"},
}

// evolvedStats is the full authored stat block for a terminal form. Zero
// FireRate means the tower never fires projectiles (laser applies damage
// continuously; cryo_field and amplifier are pure aura hardware).
type evolvedStats struct {
	Range    float64
	Damage   float64
	FireRate float64

	// Barrage: projectiles per volley, each at full Damage, distinct targets.
	MultiShot int
	// Piercer: the shot travels in a straight line and hits everything on it.
	Pierce bool
	// Executioner: damage × ExecuteBonus when target is below ExecuteThreshold
	// (fraction of max health).
	ExecuteThreshold float64
	ExecuteBonus     float64
	// Cluster / Siege: reuse the splash AOE model (radius + % of damage).
	AOERadius    float64
	AOEDamagePct float64
	// Deep Freeze: per-hit slow (same model as stasis) plus a root chance.
	SlowDuration   float64
	SlowMultiplier float64
	RootChance     float64
	RootDuration   float64
	// Cryo Field: continuous slow applied to everything in Range.
	AuraSlowMultiplier float64
	// Amplifier: damage / fire-rate buff for other towers in Range.
	AuraDamageMult float64
	AuraRateMult   float64
	// Laser: Damage is DPS, applied every tick while a target is in range.
	Beam bool
}

// Authored stat blocks. Reference points are the level-4 base towers they
// evolve from (damage ×1.728, range ×1.331 of level 1):
//
//	Pulse   L4: 25.9 dmg / 3.99 rng / 1.0 rate
//	Railgun L4: 86.4 dmg / 7.99 rng / 0.5 rate
//	Mortar  L4: 17.3 dmg / 3.33 rng / 1.5 rate (AOE 2.4u / 90%)
//	Stasis  L4: 13.8 dmg / 4.66 rng / 0.8 rate (slow 3.5s / 0.25×)
//	Tesla   L4: 34.6 dmg / 5.32 rng / 0.8 rate (5 chains / 2.1u)
var evolvedStatsByType = map[string]evolvedStats{
	// Pulse forks: single-target power vs. crowd volume.
	"breach":  {Range: 3.2, Damage: 55, FireRate: 1.4},
	"barrage": {Range: 4.2, Damage: 18, FireRate: 1.2, MultiShot: 3},
	// Railgun forks: how the kill happens.
	"piercer":     {Range: 8.0, Damage: 70, FireRate: 0.5, Pierce: true},
	"executioner": {Range: 8.0, Damage: 95, FireRate: 0.6, ExecuteThreshold: 0.20, ExecuteBonus: 2.0},
	// Mortar forks: radius vs. punch.
	"cluster": {Range: 3.6, Damage: 14, FireRate: 1.5, AOERadius: 3.5, AOEDamagePct: 1.0},
	"siege":   {Range: 3.6, Damage: 60, FireRate: 1.0, AOERadius: 1.2, AOEDamagePct: 0.6},
	// Stasis forks: area-and-always-on vs. single-target-and-severe.
	"cryo_field":  {Range: 4.5, AuraSlowMultiplier: 0.40},
	"deep_freeze": {Range: 4.5, Damage: 15, FireRate: 0.8, SlowDuration: 3.5, SlowMultiplier: 0.25, RootChance: 0.25, RootDuration: 1.5},
	// Tesla forks: sustained damage vs. support.
	"laser":     {Range: 5.5, Damage: 60, Beam: true},
	"amplifier": {Range: 3.5, AuraDamageMult: 1.25, AuraRateMult: 1.25},
}

func getEvolvedStats(towerType string) (evolvedStats, bool) {
	s, ok := evolvedStatsByType[towerType]
	return s, ok
}

// isEvolvedType reports whether towerType is one of the ten terminal forms.
func isEvolvedType(towerType string) bool {
	_, ok := evolvedStatsByType[towerType]
	return ok
}

// EvolutionCost returns what evolving would cost a tower right now.
func EvolutionCost(totalSpent int) int {
	return totalSpent * 2
}

// EvolveTower permanently evolves a max-level tower into one of its two
// terminal forms. Same locking pattern as UpgradeTower; position, rotation,
// cooldown, and current target carry over so mid-wave evolution behaves
// exactly like a mid-wave upgrade.
func (gs *GameStateWithShooting) EvolveTower(towerID int, evolution string) (Tower, error) {
	gs.mu.Lock()
	defer gs.mu.Unlock()

	for i := range gs.Towers {
		tower := &gs.Towers[i]
		if tower.ID != towerID {
			continue
		}

		if tower.Evolved {
			return Tower{}, ErrAlreadyEvolved
		}
		if tower.Level < 4 {
			return Tower{}, ErrNotMaxLevel
		}
		options, ok := evolutionOptions[tower.TowerType]
		if !ok || (evolution != options[0] && evolution != options[1]) {
			return Tower{}, ErrInvalidEvolution
		}
		stats, ok := getEvolvedStats(evolution)
		if !ok {
			return Tower{}, ErrInvalidEvolution
		}

		cost := EvolutionCost(tower.TotalSpent)
		if gs.Gold < cost {
			return Tower{}, ErrInsufficientGold
		}

		gs.Gold -= cost
		tower.TotalSpent += cost
		tower.Evolved = true
		tower.TowerType = evolution

		// Stats come fresh from the authored table; specials are cleared
		// first so nothing leaks from the base form (e.g. tesla chain fields
		// on a laser, stasis slow fields on a cryo field).
		tower.Range = stats.Range
		tower.Damage = stats.Damage
		tower.FireRate = stats.FireRate
		tower.SlowDuration = stats.SlowDuration
		tower.SlowMultiplier = stats.SlowMultiplier
		tower.AOERadius = stats.AOERadius
		tower.AOEDamage = stats.AOEDamagePct
		tower.ChainCount = 0
		tower.ChainRadius = 0
		tower.MultiShot = stats.MultiShot

		return *tower, nil
	}
	return Tower{}, ErrInvalidEvolution
}
