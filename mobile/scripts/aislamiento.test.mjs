import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { ARCHIVOS_EXENTOS_DE_TEXTO_PRIVADO, cadenasDeHermes, contieneClaveSecretaHermes, especificadoresDe, verificarBundle, verificarProyecto } from './verificar-importaciones.mjs'
import { esperarBearerExpirado, mensajeFalloEtapaAuth, validarLineaBaseExpiracion } from './integracion-auth-utils.mjs'

const RAIZ_REAL = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function proyecto(archivos, paquete = { name: 'x', dependencies: { expo: '~57.0.0' } }) {
  const raiz = mkdtempSync(join(tmpdir(), 'ept-mobile-'))
  writeFileSync(join(raiz, 'package.json'), JSON.stringify(paquete))
  for (const [ruta, contenido] of Object.entries(archivos)) {
    const destino = join(raiz, ruta)
    mkdirSync(dirname(destino), { recursive: true })
    writeFileSync(destino, contenido)
  }
  return raiz
}

function con(raiz, fn) {
  try {
    return fn(raiz)
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
}

const jwt = carga =>
  `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(carga)).toString('base64url')}.abcdefgh1234`

test('el paquete real no tiene hallazgos', () => {
  assert.deepEqual(verificarProyecto(RAIZ_REAL), [])
})

test('un proyecto limpio no tiene hallazgos', () => {
  con(proyecto({ 'src/a.ts': "import { View } from 'react-native'\nexport const a = View\n" }), raiz => {
    assert.deepEqual(verificarProyecto(raiz), [])
  })
})

const NEGATIVAS = [
  ['next/headers', { 'src/a.ts': "import { cookies } from 'next/headers'\n" }, /next\/headers/u],
  ['next/cache', { 'src/a.ts': "import { revalidatePath } from 'next/cache'\n" }, /next\/cache/u],
  ['cliente supabase.server', { 'src/a.ts': "import { s } from '../../../src/services/supabase.server'\n" }, /supabase\.server/u],
  ['cliente supabase.admin', { 'src/a.ts': "import { s } from './supabase.admin'\n" }, /supabase\.admin/u],
  ['importación fuera de mobile', { 'src/a.ts': "import { x } from '../../src/lib/errores'\n" }, /sale de mobile/u],
  ['require dinámico', { 'src/a.ts': "const n = require('next/server')\n" }, /next\/server/u],
  ['import dinámico', { 'src/a.ts': "const n = await import('next/navigation')\n" }, /next\/navigation/u],
  ['reexportación', { 'src/a.ts': "export * from 'next/headers'\n" }, /next\/headers/u],
  ['react-dom', { 'app/a.tsx': "import { createPortal } from 'react-dom'\n" }, /react-dom/u],
  ['módulo de Node', { 'src/a.ts': "import fs from 'node:fs'\n" }, /node:fs/u],
  ['service_role en fuente', { 'src/a.ts': "export const k = 'service_role'\n" }, /service_role/u],
  ['variable SUPABASE_SERVICE', { 'src/a.ts': 'export const k = process.env.SUPABASE_SERVICE_ROLE_KEY\n' }, /SUPABASE_SERVICE|service_role/u],
  ['variable pública con nombre de secreto', { '.env.example': 'EXPO_PUBLIC_API_SECRET=abc\n' }, /EXPO_PUBLIC/u],
  ['JWT con rol service_role', { 'src/a.ts': `export const k = '${jwt({ role: 'service_role' })}'\n` }, /rol distinto de anon/u],
  ['.env.local con clave privilegiada', { '.env.local': `EXPO_PUBLIC_SUPABASE_ANON_KEY=${jwt({ role: 'service_role' })}\n` }, /\.env\.local: JWT embebido/u],
  ['.env.local con nombre de secreto', { '.env.local': 'EXPO_PUBLIC_API_SECRET=abc\n' }, /\.env\.local: variable EXPO_PUBLIC/u],
  ['subruta de módulo de Node', { 'src/a.ts': "import { readFile } from 'fs/promises'\n" }, /fs\/promises/u],
]

test('un .env.local con solo valores públicos es aceptado', () => {
  con(proyecto({ '.env.local': 'EXPO_PUBLIC_SUPABASE_URL=https://x.supabase.co\n' }), raiz => {
    assert.deepEqual(verificarProyecto(raiz), [])
  })
})

for (const [nombre, archivos, esperado] of NEGATIVAS) {
  test(`detecta: ${nombre}`, () => {
    con(proyecto(archivos), raiz => {
      assert.match(verificarProyecto(raiz).join('\n'), esperado)
    })
  })
}

test('un JWT con rol anon embebido es aceptado', () => {
  con(proyecto({ 'src/a.ts': `export const k = '${jwt({ role: 'anon' })}'\n` }), raiz => {
    assert.deepEqual(verificarProyecto(raiz), [])
  })
})

test('detecta dependencias DOM o de servidor en package.json', () => {
  con(proyecto({}, { dependencies: { next: '16', 'react-dom': '19' } }), raiz => {
    const salida = verificarProyecto(raiz).join('\n')
    assert.match(salida, /«next»/u)
    assert.match(salida, /«react-dom»/u)
  })
})

test('la única exención de texto privado es la guarda de entorno', () => {
  assert.deepEqual([...ARCHIVOS_EXENTOS_DE_TEXTO_PRIVADO], ['src/configuracion/entorno.ts'])
})

test('extrae especificadores de todas las formas de importación', () => {
  const texto = [
    "import a from 'uno'",
    "import { b } from \"dos\"",
    "import 'tres'",
    "export { c } from 'cuatro'",
    "const d = require('cinco')",
    "const e = await import('seis')",
  ].join('\n')
  assert.deepEqual(especificadoresDe(texto).sort(), ['cinco', 'cuatro', 'dos', 'seis', 'tres', 'uno'])
})

test('detecta secretos y módulos de servidor dentro de un bundle exportado', () => {
  con(proyecto({ 'dist/android/index.js': 'var a=require("next/headers");' }), raiz => {
    writeFileSync(join(raiz, 'dist/android/b.js'), `var k="${jwt({ role: 'service_role' })}"`)
    const salida = verificarBundle(join(raiz, 'dist/android')).join('\n')
    assert.match(salida, /next\/headers/u)
    assert.match(salida, /service_role/u)
  })
})

test('no combina literales Hermes adyacentes al buscar claves secretas', () => {
  const cadenas = cadenasDeHermes([
    's416[ASCII, 3563..3573]: ^sb_secret_',
    's417[ASCII, 3564..3573]: sb_secret_',
    's418[ASCII, 3574..3605]: ?://host/path',
  ].join('\n'))
  assert.deepEqual(cadenas, ['^sb_secret_', 'sb_secret_', '?://host/path'])
  assert.equal(cadenas.some(cadena => /sb_secret_[A-Za-z0-9]{20,}/u.test(cadena)), false)
})

test('detecta una clave secreta completa en la tabla de cadenas Hermes', () => {
  const cadenas = cadenasDeHermes('s1[ASCII, 0..44]: sb_secret_12345678901234567890123456789012')
  assert.equal(cadenas.some(cadena => /sb_secret_[A-Za-z0-9]{20,}/u.test(cadena)), true)
})

test('acepta la guarda Hermes y detecta una clave dividida entre literales concatenados', () => {
  const guardia = [
    's1[ASCII, 0..10]: ^sb_secret_',
    's2[ASCII, 11..21]: sb_secret_',
    'NCFunction<fetchWithAuth>(2 params, 5 registers):',
    '    LoadParam         r9, 1',
    '    GetByIdShort      r7, r9, 4, "startsWith"',
    '    LoadConstString   r6, "sb_publishable_"',
    '    Call2             r6, r7, r9, r6',
    '    JmpTrue           L11, r6',
    '    GetByIdShort      r8, r9, 4, "startsWith"',
    '    LoadConstString   r7, "sb_secret_"',
    '    Call2             r6, r8, r9, r7',
    'L11:',
    '    Mov               r5, r6',
    'L9:',
    '    Not               r0, r5',
    '    StoreNPToEnvironment r4, 6, r0',
  ].join('\n')
  const dividido = [
    's1[ASCII, 0..10]: sb_secret_',
    's2[ASCII, 11..43]: 12345678901234567890123456789012',
    'NCFunction<crearClave>(0 params, 3 registers):',
    '    LoadConstString   r0, "sb_secret_"',
    '    LoadConstString   r1, "12345678901234567890123456789012"',
    '    Add               r2, r0, r1',
    '    Ret               r2',
  ].join('\n')
  assert.equal(contieneClaveSecretaHermes(guardia), false)
  assert.equal(contieneClaveSecretaHermes(dividido), true)
})

test('falla cerrado ante startsWith ajeno, sin rama o con receptor secreto', () => {
  const llamada = (funcion, receptor, incluirRama = true) => [
    `NCFunction<${funcion}>(2 params, 5 registers):`,
    `    ${receptor}`,
    '    GetByIdShort      r7, r9, 4, "startsWith"',
    '    LoadConstString   r6, "sb_publishable_"',
    '    Call2             r6, r7, r9, r6',
    ...(incluirRama ? ['    JmpTrue           L11, r6'] : []),
    '    GetByIdShort      r8, r9, 4, "startsWith"',
    '    LoadConstString   r7, "sb_secret_"',
    '    Call2             r6, r8, r9, r7',
    ...(incluirRama ? ['L11:'] : []),
    '    Mov               r5, r6',
    'L9:',
    '    Not               r0, r5',
    '    StoreNPToEnvironment r4, 6, r0',
  ].join('\n')
  assert.equal(contieneClaveSecretaHermes(llamada('otraFuncion', '    LoadParam         r9, 1')), true)
  assert.equal(contieneClaveSecretaHermes(llamada('fetchWithAuth', '    LoadParam         r9, 1', false)), true)
  assert.equal(contieneClaveSecretaHermes(llamada('fetchWithAuth', '    LoadConstString   r9, "sb_secret_fragment"')), true)
})

test('espera mediante sondeo acotado hasta que Auth deniega el bearer expirado', async () => {
  const estados = [200, 200, 401]
  const pausas = []
  const telemetry = []
  const intentos = await esperarBearerExpirado(() => estados.shift(), {
    intentosMaximos: 4,
    intervaloMs: 7,
    pausar: async ms => pausas.push(ms),
    registrarIntento: evento => telemetry.push(evento),
  })
  assert.equal(intentos, 3)
  assert.deepEqual(pausas, [7, 7])
  assert.deepEqual(telemetry, [
    { intento: 1, estado: 200 },
    { intento: 2, estado: 200 },
    { intento: 3, estado: 401 },
  ])
})

test('acepta 403 como denegación del bearer expirado y conserva el estado en telemetría', async () => {
  const telemetry = []
  const intentos = await esperarBearerExpirado(async () => 403, {
    registrarIntento: evento => telemetry.push(evento),
  })
  assert.equal(intentos, 1)
  assert.deepEqual(telemetry, [{ intento: 1, estado: 403 }])
})

test('el sondeo de expiración termina al alcanzar el límite y no revela datos', async () => {
  const telemetry = []
  await assert.rejects(
    esperarBearerExpirado(async () => 200, {
      intentosMaximos: 50,
      pausar: async () => {},
      registrarIntento: evento => telemetry.push(evento),
    }),
    { message: /no confirmó la expiración/u },
  )
  assert.equal(telemetry.length, 20)
  assert.deepEqual(telemetry.at(-1), { intento: 20, estado: 200 })
  assert.ok(telemetry.every(evento => Object.keys(evento).sort().join(',') === 'estado,intento'))
  assert.ok(telemetry.every(evento => Number.isInteger(evento.intento) && Number.isInteger(evento.estado)))
  await assert.rejects(
    esperarBearerExpirado(async () => 503, {
      intentosMaximos: 2,
      registrarIntento: evento => telemetry.push(evento),
    }),
    { message: /estado inesperado/u },
  )
  assert.deepEqual(telemetry.at(-1), { intento: 1, estado: 503 })
})

test('rechaza expiración no finita o ya pasada antes de sondear', () => {
  assert.throws(() => validarLineaBaseExpiracion(Number.NaN, 200, 10_000), /expiración futura verificable/u)
  assert.throws(() => validarLineaBaseExpiracion(9, 200, 10_000), /expiración futura verificable/u)
})

test('exige que Auth acepte el bearer recién emitido como línea base', () => {
  assert.doesNotThrow(() => validarLineaBaseExpiracion(20, 200, 10_000))
  assert.throws(() => validarLineaBaseExpiracion(20, 401, 10_000), /no aceptó el access token recién emitido/u)
})

test('el rótulo de fallo identifica una etapa sin interpolar texto arbitrario', () => {
  assert.match(mensajeFalloEtapaAuth('expiracion'), /expiración y renovación de access token/u)
  for (const [etapa, rotulo] of Object.entries({
    identidadInicial: 'identidad inicial del access token',
    esperaExp: 'espera hasta la expiración declarada',
    sondeoExp: 'comprobación de identidad tras expirar',
    refreshExpirado: 'renovación y rol tras expirar',
    logoutExpirado: 'cierre global de sesión efímera',
    refreshRevocado: 'rechazo de renovación revocada',
  })) {
    assert.ok(mensajeFalloEtapaAuth(etapa).includes(rotulo), `Falta el rótulo fijo para ${etapa}.`)
  }
  const mensaje = mensajeFalloEtapaAuth('TOKEN_PRIVADO_que_no_debe_aparecer')
  assert.match(mensaje, /etapa no identificada/u)
  assert.doesNotMatch(mensaje, /TOKEN_PRIVADO/u)
  assert.doesNotMatch(mensajeFalloEtapaAuth('refresh TOKEN_PRIVADO'), /TOKEN_PRIVADO/u)
})

test('un bundle limpio no tiene hallazgos', () => {
  con(proyecto({ 'dist/ios/index.js': 'var a=require("react-native");' }), raiz => {
    assert.deepEqual(verificarBundle(join(raiz, 'dist/ios')), [])
  })
})

test('un directorio de bundle inexistente es un hallazgo, no un pase', () => {
  assert.equal(verificarBundle(join(tmpdir(), 'no-existe-ept-bundle')).length, 1)
})
