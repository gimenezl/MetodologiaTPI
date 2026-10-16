import type { SupabaseClient } from '@supabase/supabase-js'
import {
  BUCKET_FINAL,
  BUCKET_TEMPORAL,
  MENSAJE_DESCARTE,
  esTipoComprobante,
  type MotivoDescarte,
  type TipoComprobante,
} from '@/lib/comprobantes-contrato'
import { validarComprobante, type CodigoRechazoBinario } from '@/services/comprobantes-validacion'

/**
 * Finalización de una carga de comprobante (EPT-109): la frontera de confianza.
 *
 * El cliente ya preparó la carga (RPC con su JWT) y subió los bytes a la ruta
 * temporal. Acá, con credenciales de servidor y la identidad YA autenticada por
 * el llamador:
 *   1. obtiene la carga (revalida identidad y propiedad en la base);
 *   2. lee los bytes del objeto temporal y los valida de verdad;
 *   3. publica ESOS bytes validados (desde la memoria, no copiando el objeto)
 *      en el bucket final, con upsert desactivado;
 *   4. confirma en SQL, que revalida cuenta, rol, vínculo y estado del pago y
 *      registra datos de la transferencia y comprobante en UNA transacción.
 *
 * Idempotente: repetir la llamada tras un corte retoma donde quedó. Ante una
 * respuesta perdida NUNCA borra el objeto final: primero consulta el resultado
 * durable. No es una transacción entre Storage y PostgreSQL; el protocolo la
 * reemplaza por orden de pasos + conciliación.
 */

export interface ResultadoFinalizacion {
  estado: number
  cuerpo: Record<string, unknown>
}

interface CargaParaFinalizar {
  estado: string
  pago_id: string
  ruta_temporal: string
  ruta_final: string
  tipo_mime: string
  tamano_bytes: number
  resultado: Record<string, unknown>
}

const CODIGOS_DEFINITIVOS = /^(?:P68\d\d|P5505|42501)$/u

/** SQLSTATE de la base → código de dominio y estado HTTP. Los códigos internos no salen de la API. */
const RESPUESTA_POR_SQLSTATE: Readonly<Record<string, [number, string, string]>> = {
  P6866: [404, 'CARGA_NO_ENCONTRADA', 'La carga no existe o venció. Iniciá una nueva.'],
  P6860: [400, 'DATOS_INVALIDOS', 'Revisá los datos de la carga.'],
  P6864: [409, 'CARGA_CON_OTRO_CONTENIDO', 'Esta carga ya se confirmó con otro contenido.'],
  '42501': [403, 'SIN_PERMISO', 'Tu cuenta no está habilitada para cargar comprobantes.'],
  P5505: [401, 'SIN_SESION', 'Iniciá sesión para continuar.'],
}

const incierto = (): ResultadoFinalizacion => ({
  estado: 503,
  cuerpo: {
    codigo: 'RESULTADO_INCIERTO',
    mensaje:
      'No pudimos confirmar si el comprobante quedó registrado. Revisá el estado de la carga antes de volver a enviarlo.',
  },
})

function desdeErrorSql(error: { code?: string; message?: string }): ResultadoFinalizacion {
  const conocido = error.code ? RESPUESTA_POR_SQLSTATE[error.code] : undefined
  if (conocido) {
    return { estado: conocido[0], cuerpo: { codigo: conocido[1], mensaje: conocido[2] } }
  }
  if (error.code && CODIGOS_DEFINITIVOS.test(error.code)) {
    return {
      estado: 400,
      cuerpo: { codigo: 'CARGA_NO_FINALIZADA', mensaje: 'No se pudo finalizar la carga.' },
    }
  }
  return incierto()
}

/** Borrado idempotente y silencioso: un fallo acá nunca cambia el resultado. */
async function borrar(admin: SupabaseClient, bucket: string, ruta: string): Promise<boolean> {
  try {
    const { error } = await admin.storage.from(bucket).remove([ruta])
    return !error
  } catch {
    return false
  }
}

async function descartar(
  admin: SupabaseClient,
  usuarioId: string,
  cargaId: string,
  motivo: 'ARCHIVO_INVALIDO' | 'CONTENIDO_NO_COINCIDE' | 'CUENTA_NO_HABILITADA'
): Promise<boolean> {
  const { error } = await admin.rpc('descartar_carga_comprobante', {
    p_usuario_id: usuarioId,
    p_carga_id: cargaId,
    p_motivo: motivo,
  })
  return !error
}

function motivoDe(codigo: CodigoRechazoBinario): 'ARCHIVO_INVALIDO' | 'CONTENIDO_NO_COINCIDE' {
  return codigo === 'CONTENIDO_NO_COINCIDE' || codigo === 'TIPO_NO_PERMITIDO'
    ? 'CONTENIDO_NO_COINCIDE'
    : 'ARCHIVO_INVALIDO'
}

function resultadoDescartado(carga: Record<string, unknown>): ResultadoFinalizacion {
  const motivo = String(carga.motivo_descarte ?? 'ABANDONADA') as MotivoDescarte
  const mensaje = MENSAJE_DESCARTE[motivo] ?? 'La carga fue descartada.'
  return {
    estado: motivo === 'EXPIRADA' ? 410 : 409,
    cuerpo: { codigo: motivo, mensaje, carga },
  }
}

/**
 * @param admin    cliente con service_role (solo servidor).
 * @param usuarioId id del usuario YA autenticado por el llamador (token validado).
 */
export async function finalizarCargaComprobante(
  admin: SupabaseClient,
  usuarioId: string,
  cargaId: string
): Promise<ResultadoFinalizacion> {
  // 1. Carga del propio usuario (revalida identidad y propiedad).
  const obtenida = await admin.rpc('obtener_carga_para_finalizar', {
    p_usuario_id: usuarioId,
    p_carga_id: cargaId,
  })
  if (obtenida.error) {
    // Una cuenta que ya no está habilitada no puede finalizar: se cierra la carga
    // para que la conciliación limpie su objeto temporal.
    if (obtenida.error.code === '42501') {
      await descartar(admin, usuarioId, cargaId, 'CUENTA_NO_HABILITADA')
    }
    return desdeErrorSql(obtenida.error)
  }
  const carga = obtenida.data as CargaParaFinalizar
  if (carga.estado === 'CONFIRMADA') return { estado: 200, cuerpo: { carga: carga.resultado } }
  if (carga.estado !== 'PREPARADA') return resultadoDescartado(carga.resultado)
  if (!esTipoComprobante(carga.tipo_mime)) return incierto()
  const declarado: TipoComprobante = carga.tipo_mime

  // 2. Bytes del objeto temporal. Si no está, el cliente todavía no terminó de
  //    subirlo: no se descarta (podría llegar), se pide reintentar.
  const descarga = await admin.storage.from(BUCKET_TEMPORAL).download(carga.ruta_temporal)
  if (descarga.error || !descarga.data) {
    return {
      estado: 409,
      cuerpo: {
        codigo: 'ARCHIVO_NO_SUBIDO',
        mensaje: 'El archivo todavía no llegó al servidor. Volvé a intentarlo en unos segundos.',
      },
    }
  }
  const bytes = new Uint8Array(await descarga.data.arrayBuffer())

  // 3. Validación real del contenido.
  const validacion = await validarComprobante(bytes, declarado)
  if (!validacion.ok) {
    const cerrada = await descartar(admin, usuarioId, cargaId, motivoDe(validacion.codigo))
    if (cerrada) await borrar(admin, BUCKET_TEMPORAL, carga.ruta_temporal)
    return {
      estado: 422,
      cuerpo: { codigo: validacion.codigo, mensaje: validacion.mensaje },
    }
  }
  if (validacion.tamano !== Number(carga.tamano_bytes)) {
    const cerrada = await descartar(admin, usuarioId, cargaId, 'CONTENIDO_NO_COINCIDE')
    if (cerrada) await borrar(admin, BUCKET_TEMPORAL, carga.ruta_temporal)
    return {
      estado: 422,
      cuerpo: {
        codigo: 'CONTENIDO_NO_COINCIDE',
        mensaje: MENSAJE_DESCARTE.CONTENIDO_NO_COINCIDE,
      },
    }
  }

  // 4. Publicación de los bytes VALIDADOS. Si ya existe (reintento tras un corte
  //    entre este paso y la confirmación), debe tener el mismo contenido.
  const subida = await admin.storage.from(BUCKET_FINAL).upload(carga.ruta_final, bytes, {
    contentType: validacion.tipo,
    upsert: false,
  })
  if (subida.error) {
    const existente = await admin.storage.from(BUCKET_FINAL).download(carga.ruta_final)
    if (existente.error || !existente.data) return incierto()
    const previos = new Uint8Array(await existente.data.arrayBuffer())
    const otra = await validarComprobante(previos, declarado)
    if (!otra.ok || otra.sha256 !== validacion.sha256) {
      return {
        estado: 500,
        cuerpo: {
          codigo: 'PUBLICACION_INCONSISTENTE',
          mensaje: 'No se pudo publicar el comprobante. Avisá a la institución.',
        },
      }
    }
  }

  // 5. Confirmación SQL: datos de la transferencia + comprobante, en una transacción.
  const confirmada = await admin.rpc('confirmar_carga_comprobante', {
    p_usuario_id: usuarioId,
    p_carga_id: cargaId,
    p_sha256: validacion.sha256,
    p_tamano: validacion.tamano,
    p_tipo_mime: validacion.tipo,
  })

  if (confirmada.error) {
    if (confirmada.error.code === '42501') {
      // La cuenta dejó de estar habilitada durante la carga: nada quedó
      // registrado, así que el objeto final huérfano y el temporal se retiran.
      if (await descartar(admin, usuarioId, cargaId, 'CUENTA_NO_HABILITADA')) {
        await borrar(admin, BUCKET_FINAL, carga.ruta_final)
        await borrar(admin, BUCKET_TEMPORAL, carga.ruta_temporal)
      }
    }
    // Resultado incierto (tiempo agotado, corte): no se borra nada. La carga
    // sigue PREPARADA o ya está CONFIRMADA; repetir esta llamada o consultar la
    // carga lo resuelve.
    return desdeErrorSql(confirmada.error)
  }

  const resultado = confirmada.data as Record<string, unknown>
  if (resultado.estado === 'CONFIRMADA') {
    if (await borrar(admin, BUCKET_TEMPORAL, carga.ruta_temporal)) {
      await admin.rpc('marcar_temporal_eliminado', { p_carga_id: cargaId })
    }
    return { estado: 200, cuerpo: { carga: resultado } }
  }

  // Descarte de negocio (pago ya no pendiente, número duplicado, datos
  // diferentes, vínculo revocado): sin fila en comprobantes_pago, el objeto
  // final publicado en el paso 4 es huérfano y se retira.
  if (resultado.estado === 'DESCARTADA' || resultado.estado === 'EXPIRADA') {
    const finalRetirado = await borrar(admin, BUCKET_FINAL, carga.ruta_final)
    const temporalRetirado = await borrar(admin, BUCKET_TEMPORAL, carga.ruta_temporal)
    if (finalRetirado && temporalRetirado) {
      await admin.rpc('marcar_temporal_eliminado', { p_carga_id: cargaId })
    }
    return resultadoDescartado(resultado)
  }
  return incierto()
}
