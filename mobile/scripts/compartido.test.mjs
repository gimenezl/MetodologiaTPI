import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { generar, importacionesDe } from './sync-compartido.mjs'

const RAIZ_MOBILE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RAIZ_REPO = resolve(RAIZ_MOBILE, '..')
const hayRepo = existsSync(resolve(RAIZ_REPO, 'src/lib/errores.ts'))

test('no hay deriva entre las fuentes web y la copia móvil', { skip: !hayRepo }, () => {
  for (const { salida, contenido } of generar()) {
    const actual = readFileSync(resolve(RAIZ_MOBILE, 'src/compartido', salida), 'utf8').replace(/\r\n/gu, '\n')
    assert.equal(actual, contenido, `${salida} difiere de su fuente: ejecutar npm run compartido:sync`)
  }
})

test('la copia declara su origen y es autocontenida', () => {
  for (const nombre of ['errores.ts', 'database.generated.ts']) {
    const texto = readFileSync(resolve(RAIZ_MOBILE, 'src/compartido', nombre), 'utf8')
    assert.ok(texto.startsWith('// GENERADO por mobile/scripts/sync-compartido.mjs'))
    assert.deepEqual(importacionesDe(texto), [])
  }
})

test('rechaza una fuente que deja de ser pura', () => {
  const base = mkdtempSync(join(tmpdir(), 'ept-compartido-'))
  try {
    for (const origen of ['src/lib/errores.ts', 'src/types/database.generated.ts']) {
      mkdirSync(join(base, dirname(origen)), { recursive: true })
    }
    writeFileSync(join(base, 'src/lib/errores.ts'), "import { cookies } from 'next/headers'\nexport const x = 1\n")
    writeFileSync(join(base, 'src/types/database.generated.ts'), 'export type Json = string\n')
    assert.throws(() => generar({ base }), /no puros/u)
    writeFileSync(join(base, 'src/lib/errores.ts'), "import { y } from './otro'\nexport const x = 1\n")
    assert.throws(() => generar({ base }), /autocontenido/u)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
