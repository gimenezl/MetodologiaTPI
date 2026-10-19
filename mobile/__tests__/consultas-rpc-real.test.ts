import { readFileSync } from 'node:fs'
import { analizarRegistroComprobante } from '@/servicios/consultas-familia'

// El gate JS no tiene DB; Android invoca esta misma prueba con respuestas Auth/RLS reales.
const archivo = process.env.EPT_CONSULTAS_RPC_FIXTURE
const comprobar = archivo ? test : test.skip
comprobar('contrato RPC real: ítems no vacíos de pendiente, aprobado y rechazado atraviesan el parser móvil', () => {
  const filas = JSON.parse(readFileSync(archivo!, 'utf8')) as Record<string, unknown>[]
  expect(new Set(filas.map(f => f.estado))).toEqual(new Set(['PENDIENTE_VERIFICACION', 'APROBADO', 'RECHAZADO']))
  for (const fila of filas) {
    const registro = analizarRegistroComprobante(fila)
    expect(registro.items?.length).toBeGreaterThan(0)
    for (const item of registro.items!) {
      expect(item.importeCentavos).toBe(5000000)
      expect(item.activa).toBe(registro.estado !== 'RECHAZADO')
    }
  }
})
