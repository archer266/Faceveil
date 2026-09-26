import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [packageName, ...fingerprints] = process.argv.slice(2)
const fingerprintPattern = /^(?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/

if (!/^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)+$/.test(packageName ?? '') ||
    fingerprints.length === 0 || fingerprints.some(value => !fingerprintPattern.test(value))) {
  console.error('Usage: npm run android:assetlinks -- com.example.faceveil AA:BB:... (32 hex pairs; add a second fingerprint for Play App Signing)')
  process.exitCode = 1
} else {
  const root = fileURLToPath(new URL('../public/.well-known/', import.meta.url))
  await mkdir(root, { recursive: true })
  const statement = [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: packageName,
      sha256_cert_fingerprints: fingerprints.map(value => value.toUpperCase()),
    },
  }]
  const destination = join(root, 'assetlinks.json')
  await writeFile(destination, `${JSON.stringify(statement, null, 2)}\n`)
  console.log(`Created ${destination}. Deploy at the HTTPS origin root: /.well-known/assetlinks.json`)
}
