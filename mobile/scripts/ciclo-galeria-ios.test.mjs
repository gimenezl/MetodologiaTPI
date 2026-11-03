import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

test('iOS gallery clears late password prompts without relaxing attachment assertions', () => {
  const flow = readFileSync(fileURLToPath(new URL('../maestro/ciclo-adjuntar-ios.yaml', import.meta.url)), 'utf8')
  const payment = readFileSync(fileURLToPath(new URL('../maestro/ciclo-pagar-item.yaml', import.meta.url)), 'utf8')
  const start = flow.indexOf('    commands:\n')
  const dismiss = flow.indexOf('- runFlow: ciclo-descartar-guardado.yaml', start)
  const picker = flow.indexOf("visible: 'Collections|Colecciones'", start)
  const galleryTap = flow.indexOf("- tapOn: 'Elegir una imagen de la galería'", start)
  const dismissAfterTap = flow.indexOf('- runFlow: ciclo-descartar-guardado.yaml', galleryTap)
  assert.ok(start >= 0 && dismiss > start && picker > dismiss && galleryTap > picker && dismissAfterTap > galleryTap)
  assert.match(flow, /maxRetries: 2/u)
  assert.match(flow, /visible:\s*\n\s*id: 'enviar-comprobante'\s*\n\s*enabled: true/u)
  assert.match(payment, /Comprobante recibido: pendiente de verificación/u)
})
