import fs from 'fs'
import path from 'path'
import type { Template, KioskConfig } from './types'
import type { LicenseRecord } from './license'

// Runtime config, read on every request (NOT .env.local — that's read-once + needs restart,
// and process.cwd() is unreliable under Electron/prod). Override path via SEMETA_CONFIG_PATH.
const CONFIG_PATH = process.env.SEMETA_CONFIG_PATH ?? 'C:/semeta/semeta.config.json'
const DEFAULT_DIR = 'C:/semeta'

function readConfig(): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) } catch { return {} }
}

function patchConfig(patch: Record<string, unknown>): void {
  const cfg = readConfig()
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...cfg, ...patch }, null, 2))
}

function getDataDir(): string {
  const cfg = readConfig()
  if (typeof cfg.template_local === 'string') return path.resolve(cfg.template_local)
  return path.resolve(process.env.TEMPLATE_LOCAL ?? DEFAULT_DIR)
}

// Strip surrounding/internal whitespace only. Secret is CASE-SENSITIVE on the Worker —
// never lowercase it (that turns "0A54-…" into "0a54-…" → 401 → false lock).
function normalizeSecret(raw: string): string {
  return raw.replace(/\s+/g, '')
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(getDataDir(), file), 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file: string, data: unknown): void {
  const dir = getDataDir()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, file), JSON.stringify(data, null, 2))
}

export const localDb = {
  getTemplates: (): Template[]          => readJson('templates.json', []),
  saveTemplates: (t: Template[]): void  => writeJson('templates.json', t),

  // Cache template spindonesia (dari cloud) buat offline. Kepisah dari templates.json (PB lokal).
  getSpindonesiaTemplates: (): Template[]         => readJson('spindonesia.json', []),
  saveSpindonesiaTemplates: (t: Template[]): void => writeJson('spindonesia.json', t),
  getSettings: (): Partial<KioskConfig> => readJson('settings.json', {}),
  saveSettings: (s: unknown): void      => writeJson('settings.json', s),

  getLicense: (): LicenseRecord | null  => readJson('license.json', null),
  saveLicense: (l: LicenseRecord): void => writeJson('license.json', l),

  getTemplateLocal: (): string => getDataDir(),
  setTemplateLocal: (p: string): void => patchConfig({ template_local: p }),

  // Kiosk secret lives in config (runtime-read) so saving in Settings takes effect on the
  // NEXT handshake — no restart. Env var is a fallback for fresh installs before Budi sets it.
  getSecret: (): string => {
    const cfg = readConfig()
    if (typeof cfg.kiosk_secret === 'string' && cfg.kiosk_secret) return cfg.kiosk_secret
    return process.env.KIOSK_SECRET ?? ''
  },
  setSecret: (raw: string): void => patchConfig({ kiosk_secret: normalizeSecret(raw) }),
}
