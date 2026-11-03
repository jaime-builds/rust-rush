import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryStorage } from './test/memoryStorage'

// settings.ts reads storage once at import, so each case stubs the globals
// and imports a fresh copy of the module.
const load = async (saved: string | null, reducedMotion = false) => {
  vi.resetModules()
  const storage = new MemoryStorage()
  if (saved !== null) storage.setItem('rustRushSettings', saved)
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('window', { matchMedia: () => ({ matches: reducedMotion }) })
  const mod = await import('./settings')
  return { mod, storage }
}

afterEach(() => vi.unstubAllGlobals())

describe('settings', () => {
  it('defaults every effect on with nothing saved', async () => {
    const { mod } = await load(null)
    expect(mod.getSettings()).toEqual({ screenShake: true, lowHealthPulse: true, bossBeamDown: true })
  })

  it('defaults motion effects off when the system asks for reduced motion', async () => {
    const { mod } = await load(null, true)
    expect(mod.getSettings()).toEqual({ screenShake: false, lowHealthPulse: false, bossBeamDown: false })
  })

  it('keeps saved choices over the reduced-motion default', async () => {
    const { mod } = await load(JSON.stringify({ screenShake: true }), true)
    expect(mod.getSettings().screenShake).toBe(true)
    expect(mod.getSettings().bossBeamDown).toBe(false)
  })

  it('ignores corrupt JSON, non-boolean values and removed keys', async () => {
    expect((await load('{not json')).mod.getSettings().screenShake).toBe(true)
    const { mod } = await load(JSON.stringify({ screenShake: 'no', sound: false, lowHealthPulse: false }))
    expect(mod.getSettings()).toEqual({ screenShake: true, lowHealthPulse: false, bossBeamDown: true })
  })

  it('persists a change and notifies subscribers', async () => {
    const { mod, storage } = await load(null)
    const seen = vi.fn()
    const unsubscribe = mod.subscribeSettings(seen)
    mod.setSetting('bossBeamDown', false)
    expect(seen).toHaveBeenCalledTimes(1)
    expect(JSON.parse(storage.getItem('rustRushSettings')!).bossBeamDown).toBe(false)
    unsubscribe()
    mod.setSetting('bossBeamDown', true)
    expect(seen).toHaveBeenCalledTimes(1)
  })
})
