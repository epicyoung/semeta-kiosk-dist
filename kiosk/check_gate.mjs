import { checkLicenseGate } from './lib/kiosk-config.ts'

const gate = await checkLicenseGate()
console.log('License Gate verdict:', gate)
