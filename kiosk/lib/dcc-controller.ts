// One controller per local kiosk server. All DCC commands, including capture,
// run through the same queue. Dependencies are injected for hardware-free tests.
export type CameraPhase = 'idle' | 'starting' | 'live' | 'focusing' | 'capturing' | 'recovering' | 'error'
export type CameraStatus = { phase: CameraPhase; message: string }
export interface DccIO {
  now(): number
  running(): Promise<boolean>
  launch(exe?: string): Promise<void>
  kill(exe?: string): Promise<void>
  show(): Promise<void>
  hide(): Promise<void>
  autofocus(): Promise<void>
  frame(): Promise<Buffer | null>
  log(event: string, detail?: string): void
}

export class DccController {
  private queue: Promise<unknown> = Promise.resolve()
  private owner = ''
  private stamp = 0
  private closed = new Set<string>()
  private wanted = false
  private leaseUntil = 0
  private capturePending = false
  private focusPending = false
  private previous: Buffer | null = null
  private changedAt = 0
  private healthyMs = 0
  private lastHealthyFrame = 0
  private waitUntil = 0
  private bootUntil = 0
  private shows = 0
  private restarts = 0
  private failures = 0
  private blocked = false
  private errorMessage = ''
  private needsShow = true
  private exe?: string
  private status: CameraStatus = { phase: 'idle', message: 'Live view istirahat' }
  constructor(private io: DccIO) {}
  configure(io: DccIO) { this.io = io }

  snapshot(): CameraStatus { return { ...this.status } }
  private set(phase: CameraPhase, message: string) { this.status = { phase, message } }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn)
    this.queue = result.catch(() => {})
    return result
  }
  private active(owner = this.owner) {
    return this.wanted && owner === this.owner && this.io.now() < this.leaseUntil
  }
  private fail(e: unknown) {
    this.blocked = true
    const message = e instanceof Error ? e.message : 'Periksa daya kamera, USB, dan lokasi DCC'
    this.errorMessage = message
    this.set('error', message)
    this.io.log('error', message)
  }

  async open(owner: string, exe?: string, stamp = this.io.now()) {
    if (this.closed.has(owner) || stamp < this.stamp) return this.snapshot()
    if (this.owner && this.owner !== owner) this.closed.add(this.owner)
    this.stamp = stamp
    this.owner = owner
    this.wanted = true
    this.exe = exe
    this.leaseUntil = this.io.now() + 30_000
    this.needsShow = true
    this.previous = null
    this.lastHealthyFrame = 0
    if (!this.blocked) this.set('starting', 'Menyalakan live view…')
    else this.set('error', this.errorMessage)
    return this.snapshot()
  }

  async close(owner: string) {
    // Remember cancelled sessions: a delayed OPEN must not undo an OFF.
    this.closed.add(owner)
    if (this.closed.size > 2048) this.closed.delete(this.closed.values().next().value!)
    if (owner !== this.owner) return this.snapshot()
    this.wanted = false
    return this.serial(async () => {
      if (this.wanted) return this.snapshot()
      try { await this.io.hide() } catch (e) { this.io.log('hide-failed', String(e)) }
      this.previous = null
      this.needsShow = true
      this.set('idle', 'Live view istirahat')
      return this.snapshot()
    })
  }

  async expire() {
    if (this.wanted && this.io.now() >= this.leaseUntil) await this.close(this.owner)
  }

  async reset(owner: string) {
    if (!this.active(owner) || this.capturePending || this.focusPending) return this.snapshot()
    return this.serial(async () => {
      if (!this.active(owner) || this.capturePending || this.focusPending) return this.snapshot()
      this.blocked = false
      this.restarts = 0
      this.shows = 0
      this.failures = 0
      this.waitUntil = 0
      this.needsShow = true
      this.previous = null
      this.set('recovering', 'Memulihkan kamera…')
      try { await this.io.hide() } catch { /* next poll diagnoses connection */ }
      return this.snapshot()
    })
  }

  async frame(owner: string): Promise<{ frame: Buffer | null; status: CameraStatus }> {
    if (this.active(owner)) this.leaseUntil = this.io.now() + 30_000
    return this.serial(async () => {
      let frame: Buffer | null = null
      if (!this.active(owner) || this.capturePending || this.blocked || this.status.phase === 'idle') return { frame, status: this.snapshot() }
      try {
        if (this.needsShow) {
          this.needsShow = false
          if (!await this.io.running()) {
            if (!this.active(owner)) return { frame, status: this.snapshot() }
            this.set('starting', 'Membuka DCC…')
            await this.io.launch(this.exe)
            this.bootUntil = this.io.now() + 20_000
            this.io.log('launch')
          }
          if (!this.active(owner) || this.capturePending) return { frame, status: this.snapshot() }
          try { await this.io.show() } catch { /* startup/recovery probe below */ }
          this.waitUntil = this.io.now() + 4_000
        }
        frame = await this.io.frame()
        if (!this.active(owner) || this.capturePending) return { frame: null, status: this.snapshot() }
        const now = this.io.now()
        if (frame && this.previous && !frame.equals(this.previous)) {
          this.previous = frame
          this.changedAt = now
          this.failures = 0
          this.shows = 0
          this.bootUntil = 0
          // Count healthy preview time, excluding idle/review gaps between shots.
          if (this.lastHealthyFrame && now - this.lastHealthyFrame < 4000) this.healthyMs += now - this.lastHealthyFrame
          this.lastHealthyFrame = now
          if (this.healthyMs >= 60_000) this.restarts = 0
          this.set('live', 'Kamera siap')
          return { frame, status: this.snapshot() }
        }
        if (frame && !this.previous) {
          this.previous = frame
          this.changedAt = now
        }
        if (frame && now - this.changedAt < 4_000) return { frame, status: this.snapshot() }
        this.healthyMs = 0
        this.lastHealthyFrame = 0
        this.failures++
        this.set('recovering', now < this.bootUntil ? 'Menunggu DCC siap…' : 'Memulihkan kamera…')
        if (now < this.waitUntil || this.failures < 3) return { frame, status: this.snapshot() }
        if (!await this.io.running()) {
          if (now < this.bootUntil) return { frame, status: this.snapshot() }
          if (this.restarts >= 2) throw new Error('Kamera belum terhubung. Cek daya/USB dan webserver DCC, lalu tekan R.')
          if (!this.active(owner) || this.capturePending) return { frame: null, status: this.snapshot() }
          this.restarts++
          await this.io.launch(this.exe)
          this.bootUntil = this.io.now() + 20_000
          this.shows = 0
          this.io.log('relaunch', 'Proses DCC tidak ditemukan')
        } else if (this.shows < 2) {
          if (!this.active(owner) || this.capturePending) return { frame: null, status: this.snapshot() }
          // Startup probes do not consume the two recovery attempts.
          if (now >= this.bootUntil) this.shows++
          this.io.log('restart-live-view', frame ? 'Frame beku' : 'Frame tidak tersedia')
          try { await this.io.hide(); if (this.active(owner) && !this.capturePending) await this.io.show() } catch { /* retry after grace */ }
        } else if (now >= this.bootUntil) {
          if (this.restarts >= 2) throw new Error('Kamera belum terhubung. Cek daya/USB dan webserver DCC, lalu tekan R.')
          if (!this.active(owner) || this.capturePending) return { frame: null, status: this.snapshot() }
          this.restarts++
          this.io.log('restart-dcc', frame ? 'LV tetap beku' : 'DCC tidak menghasilkan frame')
          await this.io.kill(this.exe)
          if (this.active(owner) && !this.capturePending) await this.io.launch(this.exe)
          this.bootUntil = this.io.now() + 20_000
          this.shows = 0
        }
        this.waitUntil = this.io.now() + 4_000
      } catch (e) { this.fail(e) }
      return { frame, status: this.snapshot() }
    })
  }

  async capture<T>(owner: string, fn: () => Promise<T>): Promise<T> {
    if (!this.active(owner) || this.status.phase !== 'live' || this.capturePending || this.focusPending) throw new Error('Kamera belum siap')
    this.capturePending = true
    try {
      return await this.serial(async () => {
        if (!this.active(owner)) throw new Error('Sesi kamera sudah ditutup')
        this.set('capturing', 'Mengambil foto…')
        // No recovery/Show can run until shutter and file transfer finish.
        await this.io.hide()
        return await fn()
      })
    } finally {
      this.capturePending = false
      this.needsShow = true
      this.previous = null
      if (this.wanted && this.owner !== owner) this.set('starting', 'Menyalakan live view…')
      else this.set('idle', 'Live view istirahat')
    }
  }

  async autofocus(owner: string) {
    if (!this.active(owner) || this.status.phase !== 'live' || this.capturePending || this.focusPending) throw new Error('Tunggu kamera siap sebelum autofocus.')
    this.focusPending = true
    try {
      return await this.serial(async () => {
        if (!this.active(owner) || this.status.phase !== 'live' || this.capturePending) throw new Error('Sesi kamera belum siap untuk autofocus.')
        this.set('focusing', 'Menjalankan autofocus…')
        try {
          await this.io.autofocus()
          this.io.log('autofocus-requested')
          // DCC acknowledges the command, not optical focus lock.
          return { mode: 'camera-af', message: 'Perintah autofocus terkirim. Periksa ketajaman preview.' }
        } catch (e) {
          this.io.log('autofocus-failed', String(e))
          throw new Error('Autofocus belum berhasil. Cek mode AF lensa/kamera, lalu coba lagi.')
        } finally {
          if (this.active(owner)) {
            this.changedAt = this.io.now()
            this.waitUntil = this.io.now() + 4000
            this.set('live', 'Kamera siap')
          }
        }
      })
    } finally { this.focusPending = false }
  }
}
