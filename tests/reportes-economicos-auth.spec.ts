import { test } from '@playwright/test'
import { execFileSync } from 'node:child_process'

test.skip(process.env.EPT_SUPABASE_LOCAL !== '1', 'Requiere backend local descartable con identidades reales')
test.describe('DIRECTOR autenticado: reportes económicos', () => {
  test('cinco reportes web, filtros, totales, vacío y adaptación con backend real', () => {
    test.setTimeout(180_000)
    execFileSync(process.execPath, ['supabase/tests/reportes_economicos.mjs', '--ui'], {
      env: { ...process.env, EPT_REPORTES_UI_BASE_URL: process.env.EPT_BASE_URL ?? 'http://localhost:3000' },
      encoding: 'utf8',
      timeout: 170_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  })
})
