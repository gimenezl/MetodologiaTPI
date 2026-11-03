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

test('la búsqueda del ítem descarta avisos tardíos sin repetir la selección', () => {
  const flow = readFileSync(new URL('../maestro/ciclo-pagar-item.yaml', import.meta.url), 'utf8')
  const buscar = flow.indexOf("id: 'item-${CICLO_ITEM}'")
  const retry = flow.lastIndexOf('- retry:', buscar)
  const descartar = flow.indexOf('- runFlow: ciclo-descartar-guardado.yaml', retry)
  const tocar = flow.indexOf("- tapOn:\n    id: 'item-${CICLO_ITEM}'", buscar)
  assert.ok(retry >= 0 && descartar > retry && descartar < buscar && tocar > buscar)
  assert.equal((flow.match(/id: 'item-\$\{CICLO_ITEM\}'/gu) ?? []).length, 2)
})
