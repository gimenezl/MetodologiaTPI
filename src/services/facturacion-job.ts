import { createAdminClient } from '@/services/supabase.admin'

type Clave = { alumno_id: string; periodo: string }
type Estado = { factura_id: string | null; composicion_id: string | null }
type Resultado = { resultado: 'emitida' | 'existente' | 'bloqueada'; factura_id?: string }

/** El dinero se calcula en PostgreSQL. Inicio, captura y emisión confirman por separado. */
export async function ejecutarFacturacion() {
  const db = createAdminClient(5_000)
  const limite = Date.now() + 40_000
  const plan = await db.rpc('facturacion_plan_job')
  if (plan.error) throw new Error('No se pudo consultar el plan de facturación.')
  const datos = plan.data as { habilitada: boolean; candidatos: Clave[] }
  const conteos = { emitidas: 0, existentes: 0, bloqueadas: 0, inciertas: 0 }
  if (!datos.habilitada) return { habilitada: false, ...conteos }

  // Lote acotado; próximas ejecuciones retoman pendientes sin retener un perfil.
  for (const clave of datos.candidatos.slice(0, 100)) {
    if (Date.now() >= limite) break
    const args = { p_alumno: clave.alumno_id, p_periodo: clave.periodo }
    try {
      // Progreso durable incluso si la captura posterior falla antes de su aviso.
      // Nunca marcar el lote completo ni reenviar tras un COMMIT incierto.
      const inicio = await db.rpc('facturacion_iniciar_job', args)
      if (inicio.error) {
        conteos.inciertas += 1
        continue
      }
      const captura = await db.rpc('facturacion_capturar_job', args)
      if (captura.error) {
        // Respuesta incierta: leer clave antes de cualquier emisión/repetición.
        const estado = await db.rpc('facturacion_estado_job', args)
        if (estado.error || !(estado.data as Estado)?.composicion_id) {
          conteos.inciertas += 1
          continue
        }
      } else if (!captura.data) {
        conteos.bloqueadas += 1
        continue
      }
      const emision = await db.rpc('facturacion_emitir_job', args)
      if (emision.error) {
        const estado = await db.rpc('facturacion_estado_job', args)
        if (!estado.error && (estado.data as Estado)?.factura_id) conteos.existentes += 1
        else conteos.inciertas += 1
        continue
      }
      const resultado = (emision.data as Resultado).resultado
      if (resultado === 'emitida') conteos.emitidas += 1
      else if (resultado === 'existente') conteos.existentes += 1
      else conteos.bloqueadas += 1
    } catch {
      // No se reenvía una escritura si se desconoce su desenlace.
      conteos.inciertas += 1
    }
  }
  return { habilitada: true, ...conteos }
}
