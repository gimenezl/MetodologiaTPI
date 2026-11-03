import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('el ciclo espera el campo real tras inicio en frío y conserva el recorrido', () => {
  const flow = readFileSync(new URL('../maestro/ciclo-pago.yaml', import.meta.url), 'utf8')
  const launch = flow.indexOf('- launchApp:\n    clearState: true')
  const ready = flow.indexOf("- extendedWaitUntil:\n    visible:\n      id: 'correo'\n    timeout: 60000", launch)
  const login = flow.indexOf('- runFlow: ciclo-correo.yaml', launch)
  assert.ok(launch >= 0 && ready > launch && login > ready)
  assert.equal((flow.match(/file: ciclo-pagar-item\.yaml/gu) ?? []).length, 2)
  assert.match(flow, /ciclo-pago-completado/u)
})
