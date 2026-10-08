import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { suiteProfile, validateRegistry } from './suites.mjs'

export const pureTests = ['tarifas-lib', 'asistencias-lib', 'reportes-lib', 'paginacion',
  'paginacion-paralela', 'inscripciones-legadas-lib', 'accesos-qr-cripto',
  'credenciales-qr-cripto', 'semantica-estatica', 'accesos-qr-servicio']

export function changedPaths(raw) {
  const tokens = raw.split('\0'), paths = []
  if (tokens.pop() !== '') throw new Error('Incomplete Git diff')
  while (tokens.length) {
    const status = tokens.shift()
    if (!/^(?:[ACDMUT]|[RC]\d+)$/u.test(status)) throw new Error('Invalid Git status')
    const count = /^[RC]/u.test(status) ? 2 : 1
    for (let i = 0; i < count; i++) {
      const file = tokens.shift()
      if (!file || file.startsWith('/') || file.split('/').includes('..')) throw new Error('Invalid path')
      paths.push(file)
    }
  }
  return paths
}

export function profile(paths) {
  let mode = 'fast'
  for (const file of paths) {
    if (/^(?:docs\/.*\.md|(?:README|AGENTS)\.md)$/u.test(file)) continue
    if (pureTests.some(name => file === `tests/${name}.spec.ts`)) continue
    if (/^supabase\/tests\/[^/]+\.(?:sql|mjs)$/u.test(file)) {
      const selected = suiteProfile(file.split('/').pop())
      if (selected === 'full') mode = 'full'
      else if (mode !== 'full') mode = 'db'
    } else if (file === 'src/services/facturacion-job.ts'
      || /^src\/app\/api\/(?:cron\/facturacion|facturacion)\//u.test(file)
    ) { if (mode !== 'full') mode = 'db' }
    else mode = 'full'
  }
  return mode
}

export function unsupportedPackage(file, content) {
  const dependencies = { ...content.dependencies, ...content.devDependencies }
  return /(?:^|\/)(?:mobile|android|ios)\//u.test(file)
    || 'expo' in dependencies || 'react-native' in dependencies
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateRegistry(readdirSync('supabase/tests'))
  const packages = execFileSync('git', ['ls-files', '-z', '--', 'package.json', '*/package.json'], { encoding: 'utf8' })
    .split('\0').filter(Boolean)
  if (packages.some(file => unsupportedPackage(file, JSON.parse(readFileSync(file, 'utf8'))))) {
    throw new Error('Mobile detectado: configurar sus comprobaciones reales antes de integrar; CI web insuficiente')
  }
  const base = process.env.CI_BASE_SHA, head = process.env.CI_HEAD_SHA
  if (!/^[a-f0-9]{40}$/u.test(head ?? '')) throw new Error('Invalid HEAD SHA')
  const forced = ['workflow_dispatch', 'schedule'].includes(process.env.CI_EVENT)
  const mode = forced || !/^[a-f0-9]{40}$/u.test(base ?? '') || /^0+$/u.test(base)
    ? 'full' : profile(changedPaths(execFileSync('git', ['diff', '--name-status', '-z',
      execFileSync('git', ['merge-base', base, head], { encoding: 'utf8' }).trim(), head], { encoding: 'utf8' })))
  appendFileSync(process.env.GITHUB_OUTPUT, `mode=${mode}\n`)
  console.log(`Perfil de verificación: ${mode}; revisión: ${head}`)
}
