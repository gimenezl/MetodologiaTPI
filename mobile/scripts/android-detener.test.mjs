import test from 'node:test'
import assert from 'node:assert/strict'
import { detenerAppAndroid } from './android-detener.mjs'

const encabezado = 'ACTIVITY MANAGER ACTIVITIES (dumpsys activity activities)'
const resultado = (status = 0, stdout = '') => ({ status, stdout })
test('detiene una sola vez y observa proceso y actividad ausentes', async () => {
  const llamadas = []
  await detenerAppAndroid({ ejecutar: (args) => {
    llamadas.push(args.join(' '))
    return args.includes('pidof') ? resultado(1) : resultado(0, args.includes('dumpsys') ? encabezado : '')
  } })
  assert.equal(llamadas.filter((c) => c.includes('force-stop')).length, 1)
  assert.equal(llamadas.length, 3)
})
test('actividad retenida bloquea aunque pidof ya esté vacío; converge solo al desaparecer ambos', async () => {
  let observaciones = 0
  await detenerAppAndroid({ esperar: async () => {}, ejecutar: (args) => {
    if (args.includes('pidof')) return resultado(1)
    if (args.includes('dumpsys')) return resultado(0, encabezado + (++observaciones === 1 ? '\nActivityRecord{org.educarparatransformar.app/.MainActivity}' : ''))
    return resultado()
  } })
  assert.equal(observaciones, 2)
})
test('estado retenido agota plazo y falla cerrado sin repetir force-stop', async () => {
  let tiempo = 0, detenciones = 0
  await assert.rejects(detenerAppAndroid({ ahora: () => tiempo, esperar: async () => { tiempo += 10 }, limiteMs: 10, ejecutar: (args) => {
    if (args.includes('force-stop')) detenciones++
    return args.includes('pidof') ? resultado(0, '123') : resultado(0, encabezado)
  } }), /siguen presentes/u)
  assert.equal(detenciones, 1)
})
for (const comando of ['force-stop', 'pidof', 'dumpsys']) {
  test(`fallo de ${comando} no permite continuar`, async () => {
    await assert.rejects(detenerAppAndroid({ ejecutar: (args) => args.includes(comando) ? resultado(2) : args.includes('pidof') ? resultado(1) : resultado(0, encabezado) }), /No se pudo observar/u)
  })
}
test('diagnóstico vacío no se confunde con ausencia de actividad', async () => {
  await assert.rejects(detenerAppAndroid({ ejecutar: (args) => args.includes('pidof') ? resultado(1) : resultado() }), /no disponible/u)
})
