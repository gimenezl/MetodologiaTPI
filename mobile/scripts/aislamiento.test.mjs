import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { ARCHIVOS_EXENTOS_DE_TEXTO_PRIVADO, especificadoresDe, verificarBundle, verificarProyecto } from './verificar-importaciones.mjs'

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
  ['.env local presente', { '.env.local': 'X=1\n' }, /archivo de entorno local/u],
]

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

test('un bundle limpio no tiene hallazgos', () => {
  con(proyecto({ 'dist/ios/index.js': 'var a=require("react-native");' }), raiz => {
    assert.deepEqual(verificarBundle(join(raiz, 'dist/ios')), [])
  })
})

test('un directorio de bundle inexistente es un hallazgo, no un pase', () => {
  assert.equal(verificarBundle(join(tmpdir(), 'no-existe-ept-bundle')).length, 1)
})
