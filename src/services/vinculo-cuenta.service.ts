import { setTimeout as esperar } from 'node:timers/promises'
import {
  isAuthApiError,
  isAuthRetryableFetchError,
  isAuthWeakPasswordError,
} from '@supabase/supabase-js'
import { esErrorDeConsulta, traducirErrorDeUsuarios, type CodigoDeError } from '@/lib/errores'
import { enviarCodigoDeVerificacion, leerConfiguracionSmtp } from '@/services/correo.server'
import { createAdminClient } from '@/services/supabase.admin'
import { createServerSupabaseClient } from '@/services/supabase.server'
import { fallo, type Fallo, type Resultado } from '@/services/usuarios.respuestas'

/**
 * Vínculo presencial de una cuenta a un perfil existente (EPT-59, D5).
 *
 * Solo servidor. El flujo tiene dos fases y ninguna intermedia crea una cuenta
 * ni concede permisos:
 *
 *   1. La dirección reserva la operación con su propia sesión
 *      (`reservar_vinculo_cuenta`): DNI reingresado, modalidad y constancia de
 *      que verificó el documento en persona.
 *   2. El servidor, con `service_role`, emite un desafío de 6 dígitos
 *      (`emitir_desafio_vinculo`), lo envía por correo y después lo verifica
 *      (`verificar_desafio_vinculo`). La base solo guarda el hash del código;
 *      el código existe en claro únicamente en esta petición y en el correo.
 *
 * La cuenta nace en un único paso, `auth.admin.createUser`, con el `id` que
 * fijó la reserva (`cuenta_id`) y `app_metadata.ept_vinculo`. El trigger
 * `enlazar_perfil_al_crear_cuenta` la enlaza al perfil existente dentro de la
 * misma transacción de GoTrue: o se confirman cuenta y enlace juntos, o no se
 * confirma nada. Por eso este módulo nunca borra una cuenta ni un perfil como
 * compensación. Una respuesta perdida se resuelve leyendo `datos_para_enlace`,
 * y reintentar con el mismo `id` es seguro (choca con la clave primaria).
 *
 * El perfil del Director que se pasa a las funciones de `service_role` nunca
 * sale del cuerpo de la petición: lo resuelve `requerirDirectorConPerfil` a
 * partir de la sesión verificada, y la base exige que coincida con quien
 * reservó y que siga siendo DIRECTOR habilitado.
 *
 * Nada de este módulo registra el código, el correo ni la contraseña.
 */

/** Cuántas veces se intenta crear la cuenta, como máximo, en una misma petición. */
const MAXIMO_DE_INTENTOS = 3

/** Esperas entre intentos, en milisegundos (mismo criterio que `cuentas.service.ts`). */
const ESPERAS_ENTRE_INTENTOS_MS = [250, 750]

/** Tiempo total que puede tomarse la creación antes de declararse sin confirmar. */
const LIMITE_TOTAL_DE_CREACION_MS = 15_000

type ClienteAdministrativo = ReturnType<typeof createAdminClient>

/**
 * El vínculo presencial solo está disponible con la bandera explícita y un
 * servidor SMTP configurado. Sin correo no hay forma de probar el buzón.
 */
export function vinculoDisponible(entorno: NodeJS.ProcessEnv = process.env): boolean {
  return entorno.EPT_VINCULO_CUENTAS === 'habilitado' && leerConfiguracionSmtp(entorno) !== null
}

/** Mismo formato que `app_private.enmascarar_correo`: primera letra, *** y dominio. */
export function enmascararCorreo(correo: string): string | null {
  const arroba = correo.indexOf('@')
  if (arroba < 1) return null
  return `${correo.slice(0, 1)}***@${correo.slice(arroba + 1)}`
}

function falloDeRpc(operacion: string, error: unknown): Fallo {
  const traducido = traducirErrorDeUsuarios(error)
  if (traducido.codigo === 'ERROR_INESPERADO' || traducido.codigo === 'SERVICIO_NO_DISPONIBLE') {
    console.error(`[vinculo] ${operacion} falló`, {
      code: esErrorDeConsulta(error) ? error.code : 'sin-codigo',
    })
  }
  return fallo(traducido.codigo)
}

function primeraFila<T>(data: unknown): T | null {
  return Array.isArray(data) && data.length > 0 ? (data[0] as T) : null
}

function clienteAdministrativo(): ClienteAdministrativo | null {
  try {
    return createAdminClient()
  } catch {
    console.error('[vinculo] falta la configuración del cliente administrativo')
    return null
  }
}

// ================================================================
// Reserva, consulta y cancelación (sesión de la dirección)
// ================================================================

/** Estado seguro de una reserva: nunca el hash del código ni `cuenta_id`. */
export type EstadoDeVinculo = {
  operacion_id: string
  perfil_id: string
  estado: 'PENDIENTE' | 'COMPLETADA' | 'CANCELADA' | 'VENCIDA'
  vence_en: string
  correo_enmascarado: string | null
  desafio_emitido: boolean
  correo_verificado: boolean
  intentos_restantes: number
  vinculado?: boolean
}

export type DatosDeReserva = {
  operacion_id: string
  perfil_id: string
  dni: string
  modalidad: 'TITULAR' | 'REPRESENTANTE'
  representante_dni?: string | null
}

/**
 * Reserva el vínculo. 201 si la operación es nueva, 200 si es un reintento
 * idempotente de la misma operación (misma dirección, mismo perfil, mismos
 * datos). La consulta previa solo decide el estado HTTP: la reserva la
 * serializa la base.
 */
export async function reservarVinculo(datos: DatosDeReserva): Promise<Resultado<EstadoDeVinculo>> {
  const supabase = await createServerSupabaseClient()

  const previa = await supabase.rpc('consultar_vinculo', { p_operacion_id: datos.operacion_id })
  let existia = true
  if (previa.error) {
    if (esErrorDeConsulta(previa.error) && previa.error.code === 'P5930') existia = false
    else return falloDeRpc('consultar_vinculo', previa.error)
  }

  const { data, error } = await supabase.rpc('reservar_vinculo_cuenta', {
    p_operacion_id: datos.operacion_id,
    p_perfil_id: datos.perfil_id,
    p_dni: datos.dni,
    p_modalidad: datos.modalidad,
    p_representante_dni: datos.representante_dni ?? null,
    p_documento_verificado: true,
  })
  if (error) return falloDeRpc('reservar_vinculo_cuenta', error)
  const fila = primeraFila<EstadoDeVinculo>(data)
  if (!fila) return fallo('ERROR_INESPERADO')
  return { ok: true, datos: fila, estado: existia ? 200 : 201 }
}

export async function consultarVinculo(operacionId: string): Promise<Resultado<EstadoDeVinculo>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('consultar_vinculo', { p_operacion_id: operacionId })
  if (error) return falloDeRpc('consultar_vinculo', error)
  const fila = primeraFila<EstadoDeVinculo>(data)
  if (!fila) return fallo('RESERVA_INEXISTENTE')
  return { ok: true, datos: fila }
}

export async function cancelarVinculo(operacionId: string): Promise<Resultado<EstadoDeVinculo>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('cancelar_vinculo', { p_operacion_id: operacionId })
  if (error) return falloDeRpc('cancelar_vinculo', error)
  const fila = primeraFila<EstadoDeVinculo>(data)
  if (!fila) return fallo('ERROR_INESPERADO')
  return { ok: true, datos: fila }
}

// ================================================================
// Desafío (servidor, service_role)
// ================================================================

export type DesafioEnviado = {
  enviado: true
  desafio_vence_en: string
  correo_enmascarado: string | null
}

/**
 * Emite el código, lo envía por correo y responde sin el código.
 *
 * Si el transporte falla, el desafío se anula (el hash queda en NULL): un
 * código que nadie recibió no puede servir para nada.
 */
export async function emitirDesafio(
  operacionId: string,
  directorPerfilId: string,
  correo: string
): Promise<Resultado<DesafioEnviado>> {
  const smtp = leerConfiguracionSmtp()
  if (!smtp) return fallo('VINCULO_DESHABILITADO')
  const admin = clienteAdministrativo()
  if (!admin) return fallo('SERVICIO_NO_DISPONIBLE')

  const { data, error } = await admin.rpc('emitir_desafio_vinculo', {
    p_operacion_id: operacionId,
    p_director_perfil_id: directorPerfilId,
    p_correo: correo,
  })
  if (error) return falloDeRpc('emitir_desafio_vinculo', error)
  const desafio = primeraFila<{ codigo: string; correo: string; desafio_vence_en: string }>(data)
  if (!desafio) return fallo('ERROR_INESPERADO')

  const enviado = await enviarCodigoDeVerificacion(smtp, {
    destinatario: desafio.correo,
    codigo: desafio.codigo,
    venceEn: new Date(desafio.desafio_vence_en),
  })

  if (!enviado) {
    const anulacion = await admin.rpc('anular_desafio_vinculo', {
      p_operacion_id: operacionId,
      p_director_perfil_id: directorPerfilId,
    })
    if (anulacion.error) {
      console.error('[vinculo] no se pudo anular el desafío después de un envío fallido', {
        code: esErrorDeConsulta(anulacion.error) ? anulacion.error.code : 'sin-codigo',
      })
    }
    return fallo('ENVIO_FALLIDO')
  }

  return {
    ok: true,
    estado: 202,
    datos: {
      enviado: true,
      desafio_vence_en: desafio.desafio_vence_en,
      correo_enmascarado: enmascararCorreo(desafio.correo),
    },
  }
}

// ================================================================
// Verificación y creación de la cuenta (servidor, service_role)
// ================================================================

export type VinculoCompletado = {
  vinculado: true
  operacion_id: string
  perfil_id: string
  /** `true` si el vínculo se confirmó leyendo el estado después de un resultado ambiguo. */
  reconciliado: boolean
}

type DatosParaEnlace = {
  cuenta_id: string
  correo: string
  perfil_id: string
  estado: EstadoDeVinculo['estado']
  vinculado: boolean
}

async function leerDatosParaEnlace(
  admin: ClienteAdministrativo,
  operacionId: string,
  directorPerfilId: string
): Promise<Resultado<DatosParaEnlace>> {
  const { data, error } = await admin.rpc('datos_para_enlace', {
    p_operacion_id: operacionId,
    p_director_perfil_id: directorPerfilId,
  })
  if (error) return falloDeRpc('datos_para_enlace', error)
  const fila = primeraFila<DatosParaEnlace>(data)
  if (!fila) return fallo('RESERVA_INEXISTENTE')
  return { ok: true, datos: fila }
}

function completado(
  operacionId: string,
  enlace: DatosParaEnlace,
  estado: 200 | 201,
  reconciliado: boolean
): Resultado<VinculoCompletado> {
  return {
    ok: true,
    estado,
    datos: { vinculado: true, operacion_id: operacionId, perfil_id: enlace.perfil_id, reconciliado },
  }
}

type Observacion =
  | { clase: 'confirmada' }
  /** No hubo respuesta de GoTrue: la escritura pudo haber confirmado o seguir en vuelo. */
  | { clase: 'transporte' }
  | { clase: 'contrasena' }
  | { clase: 'correo_en_uso' }
  | { clase: 'configuracion' }
  /** GoTrue respondió que no pudo: su transacción ya terminó (incluye P5940–P5947). */
  | { clase: 'explicita' }

async function intentarCreacion(
  admin: ClienteAdministrativo,
  enlace: DatosParaEnlace,
  operacionId: string,
  contrasena: string
): Promise<Observacion> {
  let respuesta: Awaited<ReturnType<ClienteAdministrativo['auth']['admin']['createUser']>>
  try {
    respuesta = await admin.auth.admin.createUser({
      id: enlace.cuenta_id,
      email: enlace.correo,
      password: contrasena,
      // `email_confirm: true` solo es alcanzable después de una prueba de buzón
      // registrada en la base: esta función corre únicamente cuando
      // `verificar_desafio_vinculo` devolvió VERIFICADO, y el trigger
      // `enlazar_perfil_al_crear_cuenta` rechaza (P5944) la cuenta entera si
      // la reserva no tiene `correo_verificado_en`, además de exigir que `id`
      // y correo sean exactamente los de la reserva (P5941, P5942).
      email_confirm: true,
      // Solo `app_metadata`: únicamente la API administrativa puede escribirlo.
      // Un `ept_vinculo` en `user_metadata` no enlaza nada.
      app_metadata: { ept_vinculo: { operacion_id: operacionId } },
    })
  } catch {
    return { clase: 'transporte' }
  }

  // La respuesta de GoTrue incluye la cuenta completa (con `app_metadata`):
  // nunca sale de esta función.
  const { data, error } = respuesta
  if (!error) return data.user ? { clase: 'confirmada' } : { clase: 'transporte' }
  if (isAuthRetryableFetchError(error)) return { clase: 'transporte' }
  if (isAuthWeakPasswordError(error)) return { clase: 'contrasena' }
  // Sin código de GoTrue (página de un intermediario, cuerpo ilegible) no hay
  // forma de saber si la escritura se procesó: se trata como transporte.
  if (!isAuthApiError(error) || !error.code) return { clase: 'transporte' }
  if (error.code === 'email_exists' || error.code === 'user_already_exists') {
    return { clase: 'correo_en_uso' }
  }
  if (error.status === 401 || error.status === 403 || error.code === 'not_admin') {
    return { clase: 'configuracion' }
  }
  return { clase: 'explicita' }
}

/**
 * Crea la cuenta ya enlazada, o explica con exactitud por qué no puede
 * afirmarlo. Nunca borra nada.
 */
async function crearCuentaVinculada(
  admin: ClienteAdministrativo,
  operacionId: string,
  directorPerfilId: string,
  contrasena: string
): Promise<Resultado<VinculoCompletado>> {
  const inicial = await leerDatosParaEnlace(admin, operacionId, directorPerfilId)
  if (!inicial.ok) return inicial
  if (inicial.datos.vinculado) return completado(operacionId, inicial.datos, 200, true)
  if (inicial.datos.estado !== 'PENDIENTE') return fallo('RESERVA_NO_VIGENTE')

  const plazo = Date.now() + LIMITE_TOTAL_DE_CREACION_MS
  // Verdadero si algún intento pudo haber confirmado sin que lo sepamos.
  let quedoAlgoSinResolver = false

  for (let numero = 1; numero <= MAXIMO_DE_INTENTOS; numero += 1) {
    if (numero > 1) {
      const espera = ESPERAS_ENTRE_INTENTOS_MS[numero - 2] ?? 750
      if (Date.now() + espera >= plazo) break
      await esperar(espera)
    }

    const observacion = await intentarCreacion(admin, inicial.datos, operacionId, contrasena)
    if (observacion.clase === 'transporte') quedoAlgoSinResolver = true

    // Después de cualquier resultado —incluido el éxito— se lee el estado.
    // Solo una lectura posterior a la respuesta de GoTrue prueba algo; tras un
    // error de transporte, una lectura negativa no prueba ausencia.
    const estado = await leerDatosParaEnlace(admin, operacionId, directorPerfilId)
    if (estado.ok && estado.datos.vinculado) {
      return completado(operacionId, estado.datos, 201, observacion.clase !== 'confirmada')
    }

    if (observacion.clase === 'confirmada') {
      if (!estado.ok && (estado.codigo === 'SERVICIO_NO_DISPONIBLE' || estado.codigo === 'ERROR_INESPERADO')) {
        // GoTrue confirmó y el enlace ocurre en su misma transacción: sin
        // lectura, esa confirmación sigue siendo la garantía.
        return completado(operacionId, inicial.datos, 201, false)
      }
      // Cuenta confirmada y perfil sin enlazar: la garantía se rompió. Se
      // informa sin borrar ni inventar nada.
      console.error('[vinculo] GoTrue confirmó la cuenta pero el perfil no quedó enlazado')
      return fallo('ESTADO_INCONSISTENTE')
    }

    if (!estado.ok) {
      if (estado.codigo === 'SERVICIO_NO_DISPONIBLE' || estado.codigo === 'ERROR_INESPERADO') {
        quedoAlgoSinResolver = true
        continue
      }
      // La base dejó de reconocer la operación para esta dirección (por
      // ejemplo, quien reservó perdió el rol): conclusivo.
      return estado
    }

    // Leído, sin enlace. Una reserva que ya no está PENDIENTE no puede
    // completarse después: el trigger toma la reserva FOR UPDATE.
    if (estado.datos.estado !== 'PENDIENTE') {
      return fallo('VINCULO_RECHAZADO')
    }

    switch (observacion.clase) {
      case 'contrasena':
        return fallo('CONTRASENA_RECHAZADA', { campo: 'contrasena' })
      case 'correo_en_uso':
        // Si la cuenta con ese correo fuera la de esta operación, la lectura
        // la habría encontrado enlazada (mismo commit).
        return fallo('CORREO_EN_USO')
      case 'configuracion':
        return fallo(quedoAlgoSinResolver ? 'VINCULO_SIN_CONFIRMAR' : 'SERVICIO_NO_DISPONIBLE')
      default:
        // Transporte o rechazo explícito sin causa visible: se reintenta con
        // el mismo `id`, que es seguro.
        continue
    }
  }

  const codigo: CodigoDeError = quedoAlgoSinResolver ? 'VINCULO_SIN_CONFIRMAR' : 'VINCULO_RECHAZADO'
  console.error('[vinculo] la creación de la cuenta no se pudo confirmar', { resultado: codigo })
  return fallo(codigo)
}

/**
 * Verifica el código y, si es correcto, crea la cuenta ya enlazada.
 *
 * Un código incorrecto no lanza excepción en la base (se perdería el
 * incremento de intentos): llega como INCORRECTO con los intentos restantes.
 * Un reintento después de un éxito (la reserva ya COMPLETADA) responde 200.
 */
export async function verificarYVincular(
  operacionId: string,
  directorPerfilId: string,
  codigo: string,
  contrasena: string
): Promise<Resultado<VinculoCompletado>> {
  const admin = clienteAdministrativo()
  if (!admin) return fallo('SERVICIO_NO_DISPONIBLE')

  const { data, error } = await admin.rpc('verificar_desafio_vinculo', {
    p_operacion_id: operacionId,
    p_director_perfil_id: directorPerfilId,
    p_codigo: codigo,
  })

  if (error) {
    const rechazo = falloDeRpc('verificar_desafio_vinculo', error)
    if (rechazo.codigo === 'RESERVA_NO_VIGENTE') {
      // ¿Es el reintento de una vinculación que ya se completó?
      const enlace = await leerDatosParaEnlace(admin, operacionId, directorPerfilId)
      if (enlace.ok && enlace.datos.vinculado) return completado(operacionId, enlace.datos, 200, true)
    }
    return rechazo
  }

  const verificacion = primeraFila<{ resultado: string; intentos_restantes: number }>(data)
  switch (verificacion?.resultado) {
    case 'VERIFICADO':
      return crearCuentaVinculada(admin, operacionId, directorPerfilId, contrasena)
    case 'INCORRECTO': {
      const restantes = Math.max(0, Number(verificacion.intentos_restantes) || 0)
      return fallo('CODIGO_INCORRECTO', {
        campo: 'codigo',
        mensaje:
          restantes > 0
            ? `El código no es correcto. ${restantes === 1 ? 'Queda 1 intento' : `Quedan ${restantes} intentos`}.`
            : 'El código no es correcto y no quedan intentos. Enviá un código nuevo.',
        extra: { intentos_restantes: restantes },
      })
    }
    case 'VENCIDO':
      return fallo('CODIGO_VENCIDO', { extra: { intentos_restantes: 0 } })
    case 'SIN_INTENTOS':
      return fallo('CODIGO_SIN_INTENTOS', { extra: { intentos_restantes: 0 } })
    default:
      console.error('[vinculo] la verificación devolvió un resultado desconocido')
      return fallo('ERROR_INESPERADO')
  }
}
