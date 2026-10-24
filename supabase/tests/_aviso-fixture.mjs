import { sql, director } from './_recordatorio-fixture.mjs'

export * from './_recordatorio-fixture.mjs'

/**
 * Ayudas de EPT-116 sobre el fixture sintético de EPT-115 (mismos hijos, niveles, tarifas y facturación).
 * Todo opera sobre el stack desechable: nunca toca datos reales.
 */
let operaciones = 0

export const compuertaAviso = (v) => sql(`UPDATE app_private.aviso_deuda_config SET habilitada=${v};`)
export const compuertaRecordatorio = (v) => sql(`UPDATE app_private.recordatorio_config SET habilitada=${v};`)

/** Ítems de un alumno en un período, por tipo (CUOTA, DEPORTE, TRANSPORTE, COMEDOR) y, para deportes, por importe. */
export const items = (alumno, periodo, tipo, importe) =>
  sql(`SELECT i.id FROM public.items_factura i JOIN public.facturas f ON f.id=i.factura_id
        WHERE i.alumno_id='${alumno}' AND f.periodo='${periodo}' AND i.tipo='${tipo}'
          ${importe === undefined ? '' : `AND i.importe=${importe}`} ORDER BY i.id`).split('\n').filter(Boolean)

/**
 * Registra un pago con sus imputaciones como lo deja la lógica de EPT-108/EPT-111:
 *  - APROBADO: ítems PAGADO e imputación activa.
 *  - PENDIENTE_VERIFICACION: ítems EN_VERIFICACION e imputación activa (la deuda se conserva).
 *  - RECHAZADO: ítems PENDIENTE e imputación inactiva (la deuda se conserva).
 * `importeInformado` es un dato de conciliación que NUNCA cancela deuda.
 */
export function pagar(padre, alumno, itemIds, estado, { importeInformado } = {}) {
  operaciones += 1
  const lista = itemIds.map((x) => `'${x}'`).join(',')
  const verificado = estado === 'PENDIENTE_VERIFICACION' ? '' : `,verificado_por,verificado_en${estado === 'RECHAZADO' ? ',motivo_rechazo' : ''}`
  const verificadoValores = estado === 'PENDIENTE_VERIFICACION' ? '' : `,'${director}',now()${estado === 'RECHAZADO' ? ",'Rechazo de prueba EPT-116'" : ''}`
  const itemEstado = estado === 'APROBADO' ? 'PAGADO' : estado === 'RECHAZADO' ? 'PENDIENTE' : 'EN_VERIFICACION'
  sql(`BEGIN;
    WITH nuevo AS (
      INSERT INTO public.pagos(padre_id,alumno_id,total_calculado,importe_informado,fecha_transferencia,numero_operacion,estado${verificado})
      SELECT '${padre}','${alumno}',COALESCE(SUM(importe),0),${importeInformado ?? 'COALESCE(SUM(importe),0)'},'2026-11-18','OP-EPT116-${operaciones}-${Date.now()}','${estado}'${verificadoValores}
        FROM public.items_factura WHERE id IN (${lista})
      RETURNING id)
    INSERT INTO public.imputaciones_pago(pago_id,item_factura_id,alumno_id,importe,activa)
      SELECT n.id,i.id,i.alumno_id,i.importe,${estado === 'RECHAZADO' ? 'FALSE' : 'TRUE'}
        FROM nuevo n CROSS JOIN public.items_factura i WHERE i.id IN (${lista});
    UPDATE public.items_factura SET estado_pago='${itemEstado}' WHERE id IN (${lista});
    COMMIT;`)
}

export const envioAviso = (padre, fecha) => JSON.parse(sql(`SELECT COALESCE(row_to_json(e),'null'::json) FROM
  (SELECT estado,intentos,ultimo_error,enviado_en IS NOT NULL AS enviado,frontera_smtp_en IS NOT NULL AS frontera,
          reserva_token IS NOT NULL AS reservado,periodo,ultimo_intento_fecha,corte_fecha,total_adeudado::text AS total,omitido_motivo
     FROM public.envios_correo WHERE padre_id='${padre}' AND tipo='AVISO_DEUDA' AND fecha_programada='${fecha}') e;`) || 'null')

export const intentosAviso = (padre, fecha) => JSON.parse(sql(`SELECT COALESCE(json_agg(row_to_json(i) ORDER BY i.intento),'[]'::json) FROM
  (SELECT i.intento,i.resultado,i.corte_fecha,i.total_adeudado::text AS total,i.detalle
     FROM public.envios_correo_intentos i JOIN public.envios_correo e ON e.id=i.envio_id
    WHERE e.padre_id='${padre}' AND e.tipo='AVISO_DEUDA' AND e.fecha_programada='${fecha}') i;`))

export const contarAvisos = () => sql(`SELECT count(*) FROM public.envios_correo WHERE tipo='AVISO_DEUDA'`)
