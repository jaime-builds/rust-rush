import { useEffect, useState, useSyncExternalStore } from 'react'
import { getSettings, setSetting, subscribeSettings, GameSettings } from '../settings'
import { sound } from '../audio/sound'

// Settings modal — exactly 5 toggles (Phase 20 scope, locked July 16):
// the three Phase 19 effects, the Phase 18 sound system, and the mute
// control relocated here from the header. Effects/sound persist via the
// settings module (rustRushSettings); mute keeps its own pre-existing
// rustRushMuted key and sound.toggleMute() logic.

interface ToggleRow {
  key: keyof GameSettings
  label: string
  desc: string
}

const TOGGLES: ToggleRow[] = [
  { key: 'screenShake', label: 'SCREEN SHAKE', desc: 'Brief jolt when a hostile reaches the goal' },
  { key: 'lowHealthPulse', label: 'LOW-HEALTH PULSE', desc: 'Ambient red warning while health is critical' },
  { key: 'bossBeamDown', label: 'BOSS BEAM-DOWN', desc: 'Materialize effect on boss spawns' },
  { key: 'sound', label: 'SOUND', desc: 'Audio system — SFX and music together' },
]

const SettingsMenu = ({ onClose }: { onClose: () => void }) => {
  const settings = useSyncExternalStore(subscribeSettings, getSettings)
  const [muted, setMuted] = useState(sound.isMuted())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-box panel" onClick={e => e.stopPropagation()}>
        <div className="settings-title">SYSTEM SETTINGS</div>
        {TOGGLES.map(row => (
          <div key={row.key} className="settings-row">
            <span className="settings-row-text">
              <span className="settings-row-label">{row.label}</span>
              <span className="settings-row-desc">{row.desc}</span>
            </span>
            <button
              className={`btn settings-toggle ${settings[row.key] ? 'btn-toggled' : ''}`}
              onClick={() => setSetting(row.key, !settings[row.key])}
            >
              {settings[row.key] ? 'ON' : 'OFF'}
            </button>
          </div>
        ))}
        <div className="settings-row">
          <span className="settings-row-text">
            <span className="settings-row-label">♪ MUTE</span>
            <span className="settings-row-desc">Silence all audio without turning the system off</span>
          </span>
          <button
            className={`btn settings-toggle ${muted ? 'btn-toggled' : ''}`}
            onClick={() => setMuted(sound.toggleMute())}
          >
            {muted ? 'ON' : 'OFF'}
          </button>
        </div>
        <button className="btn btn-big settings-close" onClick={onClose}>CLOSE</button>
      </div>
    </div>
  )
}

export default SettingsMenu
