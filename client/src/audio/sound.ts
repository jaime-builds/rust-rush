// Procedurally synthesized audio — Web Audio API only, no sample files.
//
// Everything here is oscillators, noise buffers, filters, and gain envelopes,
// which fits NEON IRONLINE's electronic aesthetic natively and keeps the repo
// free of audio assets. Two buses hang off a master gain: music (a generative
// ambient pad — low detuned drone + sparse pentatonic blips through a feedback
// delay) and SFX (exactly four: explosion, evolve confirm, wave start, game
// over — deliberately minimal per the Phase 18 scope).
//
// Browser autoplay policy: an AudioContext only produces sound after a user
// gesture, so nothing is created until unlock() is called from a pointer/key
// handler. Mute state persists in localStorage (same pattern as the high
// score) and suspends the context entirely, so a muted tab burns no audio CPU.

const MUTE_KEY = 'rustRushMuted'

const readMuted = (): boolean => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

const writeMuted = (muted: boolean) => {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    // localStorage unavailable (private mode) — mute just won't persist
  }
}

// A-minor pentatonic across two octaves — sparse, consonant in any order,
// so the random walk below never lands on a sour interval.
const ARP_NOTES = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33]

class SoundEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private sfxBus: GainNode | null = null
  private musicBus: GainNode | null = null
  private muted = readMuted()
  private arpTimer: ReturnType<typeof setInterval> | null = null
  private nextArpTime = 0
  private lastExplosionAt = 0

  isMuted(): boolean {
    return this.muted
  }

  // unlock creates (or resumes) the AudioContext and starts the music loop.
  // Must be called from a user-gesture handler the first time; safe to call
  // repeatedly.
  unlock(): void {
    if (this.muted) return // stay silent (and free) until unmuted
    this.ensureContext()
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume()
    }
  }

  // toggleMute flips and persists the mute state. Returns the new state.
  // Called from a click handler, so it doubles as an unlock gesture.
  toggleMute(): boolean {
    this.muted = !this.muted
    writeMuted(this.muted)
    if (this.muted) {
      if (this.ctx && this.master) {
        // Short ramp to zero before suspending avoids a hard click.
        this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02)
        const ctx = this.ctx
        setTimeout(() => {
          if (this.muted) void ctx.suspend()
        }, 120)
      }
    } else {
      this.ensureContext()
      if (this.ctx && this.master) {
        void this.ctx.resume()
        this.master.gain.setTargetAtTime(1, this.ctx.currentTime, 0.05)
      }
    }
    return this.muted
  }

  // --- The four SFX -------------------------------------------------------

  // Explosion: filtered noise burst + low sine thump. Throttled — a splash
  // hit can spawn several explosions in one tick, and stacking identical
  // noise bursts just gets louder, not better.
  explosion(): void {
    const ctx = this.readyCtx()
    if (!ctx || !this.sfxBus) return
    const now = performance.now()
    if (now - this.lastExplosionAt < 50) return
    this.lastExplosionAt = now

    const t = ctx.currentTime

    // Noise burst through a closing lowpass
    const noise = ctx.createBufferSource()
    noise.buffer = this.noiseBuffer(ctx, 0.3)
    const nf = ctx.createBiquadFilter()
    nf.type = 'lowpass'
    nf.frequency.setValueAtTime(900, t)
    nf.frequency.exponentialRampToValueAtTime(120, t + 0.25)
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(0.22, t)
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.28)
    noise.connect(nf).connect(ng).connect(this.sfxBus)
    noise.start(t)
    noise.stop(t + 0.3)

    // Sine thump underneath
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(95, t)
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.2)
    const og = ctx.createGain()
    og.gain.setValueAtTime(0.25, t)
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.22)
    osc.connect(og).connect(this.sfxBus)
    osc.start(t)
    osc.stop(t + 0.25)
  }

  // Evolve confirm: quick ascending three-note chime — a small "power up"
  // fanfare for the game's one irreversible action.
  evolveConfirm(): void {
    const ctx = this.readyCtx()
    if (!ctx || !this.sfxBus) return
    const t = ctx.currentTime
    const notes = [440, 554.37, 659.25] // A4, C#5, E5 — bright major arpeggio
    notes.forEach((freq, i) => {
      const start = t + i * 0.09
      this.blip(ctx, this.sfxBus!, 'triangle', freq, start, 0.35, 0.12)
      // Faint octave shimmer on top
      this.blip(ctx, this.sfxBus!, 'sine', freq * 2, start, 0.3, 0.04)
    })
  }

  // Wave start: two-note alert stab, low then high — "incoming".
  waveStart(): void {
    const ctx = this.readyCtx()
    if (!ctx || !this.sfxBus) return
    const t = ctx.currentTime
    this.stab(ctx, this.sfxBus, 220, t, 0.14)
    this.stab(ctx, this.sfxBus, 330, t + 0.16, 0.2)
  }

  // Game over: slow descending minor line, filtered soft.
  gameOver(): void {
    const ctx = this.readyCtx()
    if (!ctx || !this.sfxBus) return
    const t = ctx.currentTime
    const notes = [440, 349.23, 293.66, 220] // A4 F4 D4 A3
    notes.forEach((freq, i) => {
      const start = t + i * 0.28
      const dur = i === notes.length - 1 ? 1.2 : 0.5
      this.blip(ctx, this.sfxBus!, 'triangle', freq, start, dur, 0.14)
      this.blip(ctx, this.sfxBus!, 'sine', freq / 2, start, dur, 0.08)
    })
  }

  // --- Internals ----------------------------------------------------------

  private ensureContext(): void {
    if (this.ctx) return
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    this.ctx = new Ctor()

    this.master = this.ctx.createGain()
    this.master.gain.value = this.muted ? 0 : 1
    this.master.connect(this.ctx.destination)

    this.sfxBus = this.ctx.createGain()
    this.sfxBus.gain.value = 0.5
    this.sfxBus.connect(this.master)

    this.musicBus = this.ctx.createGain()
    this.musicBus.gain.value = 0.3 // deliberately "barely there"
    this.musicBus.connect(this.master)

    this.startMusic()
  }

  private readyCtx(): AudioContext | null {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return null
    return this.ctx
  }

  // startMusic wires the generative pad: a low detuned two-oscillator drone
  // under a slowly breathing lowpass, plus a sparse random pentatonic blip
  // every few seconds through a feedback delay. Generative, so it "loops"
  // seamlessly by construction — there is no seam.
  private startMusic(): void {
    const ctx = this.ctx
    if (!ctx || !this.musicBus) return

    // Drone: A1 + E2, sawtooths, barely detuned for slow phasing movement.
    const droneFilter = ctx.createBiquadFilter()
    droneFilter.type = 'lowpass'
    droneFilter.frequency.value = 220
    droneFilter.Q.value = 0.8
    const droneGain = ctx.createGain()
    droneGain.gain.value = 0.16
    droneFilter.connect(droneGain).connect(this.musicBus)

    for (const [freq, detune] of [[55, 0], [82.41, 4]] as const) {
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = freq
      osc.detune.value = detune
      osc.connect(droneFilter)
      osc.start()
    }

    // The filter cutoff breathes on a ~20s cycle — the "hum" feels alive
    // without ever drawing attention to itself.
    const lfo = ctx.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = 0.05
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 90
    lfo.connect(lfoGain).connect(droneFilter.frequency)
    lfo.start()

    // Arpeggio bus: blips feed a feedback delay for space.
    const delay = ctx.createDelay(1.0)
    delay.delayTime.value = 0.45
    const feedback = ctx.createGain()
    feedback.gain.value = 0.35
    const arpDry = ctx.createGain()
    arpDry.gain.value = 0.5
    delay.connect(feedback).connect(delay)
    delay.connect(this.musicBus)
    arpDry.connect(this.musicBus)

    // Lookahead scheduler: wakes 2×/sec, schedules any blip due in the next
    // 1.5s on the audio clock. Interval jitter therefore never causes gaps.
    this.nextArpTime = ctx.currentTime + 2
    if (this.arpTimer) clearInterval(this.arpTimer)
    this.arpTimer = setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running') return
      while (this.nextArpTime < this.ctx.currentTime + 1.5) {
        // ~1 in 3 slots rests — sparseness is the point.
        if (Math.random() > 0.33) {
          const freq = ARP_NOTES[Math.floor(Math.random() * ARP_NOTES.length)]
          const target = ctx.createGain()
          target.connect(arpDry)
          target.connect(delay)
          this.blip(ctx, target, 'sine', freq, this.nextArpTime, 2.2, 0.07)
        }
        this.nextArpTime += 1.6 + Math.random() * 1.8
      }
    }, 500)
  }

  // blip: one soft enveloped tone. attack 20ms, exponential release.
  private blip(
    ctx: AudioContext,
    out: AudioNode,
    type: OscillatorType,
    freq: number,
    start: number,
    dur: number,
    peak: number,
  ): void {
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, start)
    g.gain.exponentialRampToValueAtTime(peak, start + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
    osc.connect(g).connect(out)
    osc.start(start)
    osc.stop(start + dur + 0.05)
  }

  // stab: short dual-detuned-saw hit through a bandpass — the alert voice.
  private stab(ctx: AudioContext, out: AudioNode, freq: number, start: number, dur: number): void {
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = freq * 2
    bp.Q.value = 1.2
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, start)
    g.gain.exponentialRampToValueAtTime(0.18, start + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
    bp.connect(g).connect(out)
    for (const detune of [-6, 6]) {
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = freq
      osc.detune.value = detune
      osc.connect(bp)
      osc.start(start)
      osc.stop(start + dur + 0.05)
    }
  }

  private noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1
    }
    return buf
  }
}

// Singleton — audio is inherently global to the page.
export const sound = new SoundEngine()
