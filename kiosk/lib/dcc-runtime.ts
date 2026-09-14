import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { DccController, type DccIO } from './dcc-controller'
import { DCC_DEFAULT_PATH, isValidDccPath } from './dcc-supervisor'
import { localDb } from './local-db'

const exec = promisify(execFile)
export async function dccFetch(endpoint: string, timeout = 2500) {
  return fetch(`http://127.0.0.1:5513/${endpoint}`, { cache: 'no-store', signal: AbortSignal.timeout(timeout) })
}
async function command(cmd: string) {
  const response = await dccFetch(`?CMD=${encodeURIComponent(cmd.trim())}`)
  try { if (!response.ok) throw new Error(`DCC HTTP ${response.status}`) }
  finally { await response.body?.cancel() }
}
export function validateDccExe(override?: string) {
  const exe = override?.trim() || process.env.DCC_PATH?.trim() || localDb.getSettings().dcc_path?.trim() || DCC_DEFAULT_PATH
  if (!isValidDccPath(exe) || path.win32.basename(exe).toLowerCase() !== 'cameracontrol.exe') throw new Error('Pilih CameraControl.exe milik digiCamControl di Settings.')
  if (!fs.existsSync(exe) || !fs.statSync(exe).isFile()) throw new Error('CameraControl.exe tidak ditemukan. Periksa lokasi DCC di Settings.')
  return exe
}
function log(event: string, detail = '') {
  const entry = JSON.stringify({ time: new Date().toISOString(), event, detail }) + '\n'
  console.info('[dcc]', entry.trim())
  try {
    const dir = path.join(localDb.getTemplateLocal(), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'dcc-recovery.log')
    if (fs.existsSync(file) && fs.statSync(file).size > 1_000_000) fs.renameSync(file, file + '.previous')
    fs.appendFileSync(file, entry)
  } catch { /* Logging must never break a capture. */ }
}
function createIO(): DccIO {
  return {
    now: Date.now, log,
    running: async () => {
      const { stdout } = await exec('tasklist', ['/FI', 'IMAGENAME eq CameraControl.exe', '/NH'], { windowsHide: true, timeout: 5000 })
      return /CameraControl\.exe/i.test(stdout)
    },
    launch: async override => {
      const exe = validateDccExe(override)
      await new Promise<void>((resolve, reject) => {
        const child = spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore', windowsHide: true })
        child.once('error', reject)
        child.once('spawn', () => { child.unref(); resolve() })
      })
    },
    kill: async override => {
      validateDccExe(override)
      await exec('taskkill', ['/F', '/IM', 'CameraControl.exe', '/T'], { windowsHide: true, timeout: 8000 })
    },
    show: async () => {
      for (const cmd of (process.env.CANON_LV_CMDS ?? 'LiveViewWnd_Show,LiveViewWnd_Maximized').split(',')) await command(cmd)
    },
    hide: async () => {
      const cmd = process.env.CANON_LV_HIDE ?? 'LiveViewWnd_Hide'
      if (cmd !== 'off') await command(cmd)
    },
    autofocus: async () => {
      // https://www.digicamcontrol.com/doc/userguide/singlecmd
      const r = await dccFetch('?slc=do&param1=LiveView_Focus', 8000)
      const reply = (await r.text()).trim()
      if (!r.ok || !/^ok$/i.test(reply)) throw new Error(`DCC autofocus rejected: ${reply.slice(0, 160)}`)
    },
    frame: async () => {
      for (const p of (process.env.CANON_LIVE_PATH ?? 'liveview.jpg,preview.jpg,live').split(',')) {
        try {
          const r = await dccFetch(p.trim())
          if (!r.ok) { await r.body?.cancel(); continue }
          const buf = Buffer.from(await r.arrayBuffer())
          if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9) return buf
        } catch { /* next endpoint; timeout also covers reading the body */ }
      }
      return null
    },
  }
}
// Shared across route bundles and HMR in this single-process local server.
const shared = globalThis as typeof globalThis & { semetaDcc?: DccController; semetaDccTimer?: ReturnType<typeof setInterval> }
export const dcc = shared.semetaDcc ??= new DccController(createIO())
// Dev HMR must adopt new commands without losing the active queue/session.
Object.setPrototypeOf(dcc, DccController.prototype)
dcc.configure(createIO())
if (!shared.semetaDccTimer) {
  shared.semetaDccTimer = setInterval(() => { void dcc.expire().catch(e => log('lease-error', String(e))) }, 5000)
  shared.semetaDccTimer.unref()
}
