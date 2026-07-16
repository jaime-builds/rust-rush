// Player-facing effect/audio preferences — one JSON blob in localStorage
// (same persistence pattern as rustRushHighScore/rustRushMuted, combined into
// a single key since the toggles ship and change together).
//
// The canvas render loop reads flags straight off `settings.current` every
// frame (plain property reads, no React), while the settings menu subscribes
// for re-renders. Mute is NOT here — it lives in sound.ts under its own
// pre-existing rustRushMuted key.

const SETTINGS_KEY = 'rustRushSettings'

export interface GameSettings {
  /** Small canvas shake when an enemy leaks through and health drops. */
  screenShake: boolean
  /** Ambient red edge pulse while health is critically low. */
  lowHealthPulse: boolean
  /** Beam-down materialize effect on boss spawns. */
  bossBeamDown: boolean
  /** Master switch for the Phase 18 audio system (SFX + music together). */
  sound: boolean
}

const DEFAULTS: GameSettings = {
  screenShake: true,
  lowHealthPulse: true,
  bossBeamDown: true,
  sound: true,
}

const read = (): GameSettings => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<Record<keyof GameSettings, unknown>>
    // Merge over defaults so new toggles added later default ON for
    // players with an older saved blob.
    const merged = { ...DEFAULTS }
    for (const key of Object.keys(DEFAULTS) as (keyof GameSettings)[]) {
      if (typeof parsed[key] === 'boolean') merged[key] = parsed[key] as boolean
    }
    return merged
  } catch {
    return { ...DEFAULTS }
  }
}

const write = (value: GameSettings) => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(value))
  } catch {
    // localStorage unavailable (private mode) — settings just won't persist
  }
}

type Listener = () => void
const listeners = new Set<Listener>()

export const settings: { current: GameSettings } = { current: read() }

export const getSettings = (): GameSettings => settings.current

export const setSetting = <K extends keyof GameSettings>(key: K, value: GameSettings[K]): void => {
  settings.current = { ...settings.current, [key]: value }
  write(settings.current)
  listeners.forEach(l => l())
}

// subscribe/getSettings pair is useSyncExternalStore-compatible.
export const subscribeSettings = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
