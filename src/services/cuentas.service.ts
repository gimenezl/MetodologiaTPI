import { setTimeout as esperar } from 'node:timers/promises'
import {
  isAuthApiError,
  isAuthError,
  isAuthRetryableFetchError,
  isAuthWeakPasswordError,
} from '@supabase/supabase-js'
import type { CodigoDeError } from '@/lib/errores'
import type { createAdminClient } from '@/services/supabase.admin'

/**
 * Alta de una cuenta de acceso con su perfil (EPT-9, cuarta revisión).
 *
 * Solo servidor: recibe el cliente administrativo, que lleva la clave
 * `service_role`. Nunca importar desde un componente cliente.
 *
 * ## Dónde está la atomicidad
 *
 * No acá. Está en PostgreSQL: la migración 010 crea el perfil dentro de la
 * misma transacción en la que GoTrue crea la cuenta. Esta capa hace una sola
 * escritura —`auth.admin.createUser`— y la cuenta y el perfil se confirman
 * juntos o no se confirma ninguno. No existe un estado «cuenta sin perfil» que
 * reparar, así que no existe ninguna compensación: este módulo no borra
 * cuentas en ningún camino.
 *
 * ## Qué queda ambiguo y cómo se resuelve
 *
 * La respuesta HTTP sí puede perderse. Un error de transporte no dice si la
 * transacción confirmó, si fue revertida o si todavía está en vuelo. Una
 * lectura vacía inmediata tampoco lo dice: la escritura puede llegar un
 * instante después.
 *
 * Por eso el `id` de la cuenta no lo elige GoTrue sino quien pide el alta: es
 * la clave de idempotencia de la operación. Reintentar con el mismo `id` es
 * seguro y es, además, lo que resuelve la ambigüedad:
 *
 * - si el intento anterior confirmó, el reintento choca con la clave primaria
 *   y la consulta por `id` encuentra la cuenta y su perfil;
 * - si todavía está en vuelo, el reintento espera en la clave primaria hasta
 *   que termine (se verificó sobre GoTrue v2.196.0);
 * - si nunca llegó o fue revertido, el reintento crea la cuenta.
 *
 * Solo una respuesta explícita de GoTrue —que llega después de que su
 * transacción terminó— habilita a consultar el estado y sacar conclusiones.
 * Un error de transporte nunca se interpreta como ausencia.
 *
 * ## Las clases de resultado
 *
 * | Observación                                   | Resultado                          |
 * | --------------------------------------------- | ---------------------------------- |
 * | Alta confirmada por GoTrue + perfil verificado | confirmada                         |
 * | Alta confirmada por GoTrue + cuenta sin perfil | ESTADO_INCONSISTENTE (nada se borró) |
 * | Respuesta explícita + cuenta y perfil propios | confirmada (reconciliada)           |
 * | Respuesta explícita + datos distintos         | OPERACION_REUTILIZADA               |
 * | Respuesta explícita + cuenta sin perfil       | ESTADO_INCONSISTENTE                |
 * | Respuesta explícita + DNI, legajo o email ajeno | DNI/LEGAJO/EMAIL_DUPLICADO        |
 * | Rechazo sin causa visible, sin ambigüedad previa | ALTA_RECHAZADA (nada se guardó)  |
 * | Algún resultado de transporte sin resolver    | ALTA_SIN_CONFIRMAR (nada se borró)  |
 */

type ClienteAdministrativo = ReturnType<typeof createAdminClient>

/** Cuántas escrituras intenta, como máximo, una misma operación. */
export const MAXIMO_DE_INTENTOS = 3

/** Esperas entre intentos, en milisegundos. */
const ESPERAS_ENTRE_INTENTOS_MS = [250, 750]

/** Tiempo total que la operación puede tomarse antes de declararse sin confirmar. */
export const LIMITE_TOTAL_DEL_ALTA_MS = 15_000

export type PerfilDeAlta = {
  nombre: string
  apellido: string
  dni: string
  rol_id: number
  telefono: string | null
  direccion: string | null
  legajo_nro: string | null
}

export type SolicitudDeAlta = {
  /** UUID v4. Es a la vez la clave de idempotencia y el `id` de la cuenta. */
  operacionId: string
  email: string
  password: string
  perfil: PerfilDeAlta
  esEstudiante: boolean
}

export type ResultadoDelAlta =
  | { tipo: 'confirmada'; userId: string; reconciliada: boolean }
  | { tipo: 'error'; codigo: CodigoDeError }

/** Lo que se registra en el servidor: clasificaciones, nunca datos personales. */
export type DiagnosticoDelAlta = {
  comprobacionPrevia?: string
  intentos: {
    numero: number
    observacion: string
    estadoHttp: number | null
    codigoAuth: string | null
    reconciliacion?: EstadoDeLaOperacion
    titulares?: string
  }[]
}

// ================================================================
// Consulta del estado de una operación
// ================================================================

export type EstadoDeLaOperacion =
  /** No existe la cuenta ni un perfil con ese `id`. */
  | 'ausente'
  /** Existen la cuenta y su perfil, con exactamente los datos pedidos. */
  | 'coherente'
  /** Existe una cuenta con ese `id`, pero con otros datos. */
  | 'incompatible'
  /** Una cuenta sin perfil, un perfil sin cuenta o un estudiante sin legajo académico. */
  | 'inconsistente'
  /** No se pudo consultar. No se concluye nada. */
  | 'desconocido'

const normalizarEmail = (email: string) => email.trim().toLowerCase()

/**
 * Pregunta qué existe para el `id` de la operación.
 *
 * Es una lectura: no modifica nada y se puede repetir. Solo se llama después de
 * una respuesta de GoTrue —de éxito o de error—, cuando la transacción de ese
 * intento ya terminó.
 */
export async function consultarOperacion(
  admin: ClienteAdministrativo,
  solicitud: SolicitudDeAlta
): Promise<EstadoDeLaOperacion> {
  const id = solicitud.operacionId

  const cuenta = await admin.auth.admin.getUserById(id)
  let emailDeLaCuenta: string | null = null
  if (cuenta.error) {
    const noExiste =
      isAuthApiError(cuenta.error) &&
      cuenta.error.status === 404 &&
      cuenta.error.code === 'user_not_found'
    if (!noExiste) return 'desconocido'
  } else {
    emailDeLaCuenta = cuenta.data.user?.email ?? ''
  }

  const perfiles = await admin
    .from('perfiles')
    .select('id, nombre, apellido, dni, rol_id, telefono, direccion, legajo_nro')
    .eq('user_id', id)
  if (perfiles.error) return 'desconocido'
  const filas = perfiles.data ?? []

  if (emailDeLaCuenta === null && filas.length === 0) return 'ausente'

  if (emailDeLaCuenta === null) {
    // Un perfil que apunta a una cuenta inexistente. Con la migración 010 no
    // puede nacer por esta ruta; si aparece, no se toca.
    return 'inconsistente'
  }

  const mismaCuenta = normalizarEmail(emailDeLaCuenta) === normalizarEmail(solicitud.email)

  if (filas.length === 0) {
    // Una cuenta con ese `id` y sin perfil. Si el email coincide, es esta misma
    // operación y el perfil no se creó: eso contradice la migración 010 y se
    // informa sin modificar nada. Si no coincide, el `id` pertenece a otra
    // cuenta.
    return mismaCuenta ? 'inconsistente' : 'incompatible'
  }

  const perfil = filas[0]
  const pedido = solicitud.perfil
  const mismosDatos =
    perfil.nombre === pedido.nombre &&
    perfil.apellido === pedido.apellido &&
    perfil.dni === pedido.dni &&
    perfil.rol_id === pedido.rol_id &&
    (perfil.telefono ?? null) === pedido.telefono &&
    (perfil.direccion ?? null) === pedido.direccion &&
    (perfil.legajo_nro ?? null) === pedido.legajo_nro

  if (!mismaCuenta || !mismosDatos) return 'incompatible'

  if (solicitud.esEstudiante) {
    const academico = await admin.from('alumnos').select('perfil_id').eq('perfil_id', perfil.id)
    if (academico.error) return 'desconocido'
    if ((academico.data ?? []).length !== 1) return 'inconsistente'
  }

  return 'coherente'
}

// ================================================================
// Titulares del DNI y del legajo
// ================================================================

export type Titulares =
  | { tipo: 'libres' }
  | { tipo: 'ocupados'; codigo: 'DNI_DUPLICADO' | 'LEGAJO_DUPLICADO'; propio: boolean }
  | { tipo: 'desconocido' }

/** Escapa un valor para usarlo como patrón literal en `ilike`. */
function patronLiteral(valor: string) {
  return valor.replace(/[\\%_]/gu, (caracter) => `\\${caracter}`)
}

/**
 * Busca quién tiene hoy el DNI o el legajo pedidos.
 *
 * El DNI se compara exacto. El legajo es único sin distinguir mayúsculas (índice
 * `idx_perfiles_legajo_normalizado`), así que se buscan candidatos con `ilike`
 * y se confirma cada uno comparando en mayúsculas: `ilike` solo acota la
 * búsqueda, nunca decide.
 *
 * Se consultan por separado en lugar de con un filtro `or`: el filtro `or` de
 * PostgREST se arma concatenando texto, y un legajo con coma o paréntesis
 * —válido según el contrato— rompería la expresión.
 */
export async function buscarTitulares(
  admin: ClienteAdministrativo,
  solicitud: SolicitudDeAlta
): Promise<Titulares> {
  const { dni, legajo_nro } = solicitud.perfil

  const [porDni, porLegajo] = await Promise.all([
    admin.from('perfiles').select('user_id').eq('dni', dni).limit(1),
    legajo_nro
      ? admin
          .from('perfiles')
          .select('user_id, legajo_nro')
          .ilike('legajo_nro', patronLiteral(legajo_nro))
      : Promise.resolve({ data: [] as { user_id: string | null; legajo_nro: string | null }[], error: null }),
  ])

  if (porDni.error || porLegajo.error) return { tipo: 'desconocido' }

  const titularDni = (porDni.data ?? [])[0]
  if (titularDni) {
    return {
      tipo: 'ocupados',
      codigo: 'DNI_DUPLICADO',
      propio: titularDni.user_id === solicitud.operacionId,
    }
  }

  if (legajo_nro) {
    const buscado = legajo_nro.toUpperCase()
    const titularLegajo = (porLegajo.data ?? []).find(
      (fila) => (fila.legajo_nro ?? '').toUpperCase() === buscado
    )
    if (titularLegajo) {
      return {
        tipo: 'ocupados',
        codigo: 'LEGAJO_DUPLICADO',
        propio: titularLegajo.user_id === solicitud.operacionId,
      }
    }
  }

  return { tipo: 'libres' }
}

// ================================================================
// Un intento de escritura
// ================================================================

type Observacion =
  | { clase: 'confirmada'; userId: string }
  /** No hubo respuesta de GoTrue: la escritura puede haber confirmado o seguir en vuelo. */
  | { clase: 'transporte'; estadoHttp: number | null }
  /** GoTrue rechazó los datos antes de escribir. Terminal. */
  | { clase: 'datos'; codigo: 'CONTRASENA_RECHAZADA' | 'DATOS_INVALIDOS'; estadoHttp: number; codigoAuth: string }
  /** GoTrue no procesó el pedido por límite de frecuencia. */
  | { clase: 'frecuencia'; estadoHttp: number; codigoAuth: string | null }
  /** La clave administrativa no fue aceptada. Terminal. */
  | { clase: 'configuracion'; estadoHttp: number; codigoAuth: string | null }
  /** GoTrue respondió que no pudo: su transacción ya terminó. */
  | { clase: 'explicita'; estadoHttp: number; codigoAuth: string }

const CODIGOS_DE_DATOS_INVALIDOS = new Set([
  'validation_failed',
  'email_address_invalid',
  'email_address_not_authorized',
])

const CODIGOS_DE_CONFIGURACION = new Set(['not_admin', 'no_authorization', 'bad_jwt'])

async function intentarAlta(
  admin: ClienteAdministrativo,
  solicitud: SolicitudDeAlta
): Promise<Observacion> {
  let respuesta: Awaited<ReturnType<ClienteAdministrativo['auth']['admin']['createUser']>>
  try {
    respuesta = await admin.auth.admin.createUser({
      id: solicitud.operacionId,
      email: solicitud.email,
      password: solicitud.password,
      email_confirm: true,
      // El perfil viaja por `app_metadata`, que solo la API administrativa puede
      // escribir. El trigger de la migración 010 lo lee, crea el perfil en la
      // misma transacción y retira la clave antes de guardar la fila.
      app_metadata: { ept_alta: solicitud.perfil },
    })
  } catch {
    // El cliente no debería lanzar, pero si lo hace no hay respuesta que leer.
    return { clase: 'transporte', estadoHttp: null }
  }

  const { data, error } = respuesta
  if (!error) {
    return data.user
      ? { clase: 'confirmada', userId: data.user.id }
      : { clase: 'transporte', estadoHttp: null }
  }

  if (isAuthRetryableFetchError(error)) {
    return { clase: 'transporte', estadoHttp: error.status ?? null }
  }

  if (isAuthWeakPasswordError(error)) {
    return {
      clase: 'datos',
      codigo: 'CONTRASENA_RECHAZADA',
      estadoHttp: error.status ?? 422,
      codigoAuth: 'weak_password',
    }
  }

  // Un error de Auth con código viene de GoTrue. Sin código —una página de
  // error de un intermediario, un cuerpo ilegible— no hay forma de saber si
  // GoTrue llegó a procesar el pedido, y se trata como transporte.
  if (!isAuthApiError(error) || !error.code) {
    return { clase: 'transporte', estadoHttp: isAuthError(error) ? (error.status ?? null) : null }
  }

  const estadoHttp = error.status
  const codigoAuth = error.code

  if (CODIGOS_DE_DATOS_INVALIDOS.has(codigoAuth)) {
    return { clase: 'datos', codigo: 'DATOS_INVALIDOS', estadoHttp, codigoAuth }
  }
  if (estadoHttp === 429 || codigoAuth.startsWith('over_')) {
    return { clase: 'frecuencia', estadoHttp, codigoAuth }
  }
  if (estadoHttp === 401 || estadoHttp === 403 || CODIGOS_DE_CONFIGURACION.has(codigoAuth)) {
    return { clase: 'configuracion', estadoHttp, codigoAuth }
  }
  return { clase: 'explicita', estadoHttp, codigoAuth }
}

// ================================================================
// La operación completa
// ================================================================

/**
 * Resuelve lo que ya se sabe de la operación antes de escribir.
 *
 * Si el DNI o el legajo pertenecen a esta misma operación, es un reintento de
 * un alta que ya confirmó: se reconcilia en lugar de rechazarlo como duplicado.
 */
async function comprobacionPrevia(
  admin: ClienteAdministrativo,
  solicitud: SolicitudDeAlta,
  diagnostico: DiagnosticoDelAlta
): Promise<ResultadoDelAlta | null> {
  const titulares = await buscarTitulares(admin, solicitud)

  if (titulares.tipo === 'desconocido') {
    diagnostico.comprobacionPrevia = 'titulares-desconocidos'
    return { tipo: 'error', codigo: 'SERVICIO_NO_DISPONIBLE' }
  }
  if (titulares.tipo === 'libres') {
    diagnostico.comprobacionPrevia = 'libres'
    return null
  }
  if (!titulares.propio) {
    diagnostico.comprobacionPrevia = `ocupado-${titulares.codigo}`
    return { tipo: 'error', codigo: titulares.codigo }
  }

  const estado = await consultarOperacion(admin, solicitud)
  diagnostico.comprobacionPrevia = `propio-${estado}`
  return resultadoDeLaConsulta(estado, solicitud) ?? { tipo: 'error', codigo: 'ALTA_SIN_CONFIRMAR' }
}

function resultadoDeLaConsulta(
  estado: EstadoDeLaOperacion,
  solicitud: SolicitudDeAlta
): ResultadoDelAlta | null {
  switch (estado) {
    case 'coherente':
      return { tipo: 'confirmada', userId: solicitud.operacionId, reconciliada: true }
    case 'incompatible':
      return { tipo: 'error', codigo: 'OPERACION_REUTILIZADA' }
    case 'inconsistente':
      return { tipo: 'error', codigo: 'ESTADO_INCONSISTENTE' }
    default:
      return null
  }
}

/**
 * Crea la cuenta y su perfil, o explica con exactitud por qué no puede afirmarlo.
 *
 * Nunca borra nada. Ante cualquier duda devuelve `ALTA_SIN_CONFIRMAR`, que deja
 * el estado intacto y recuperable: reintentar con la misma operación converge.
 */
export async function registrarCuentaConPerfil(
  admin: ClienteAdministrativo,
  solicitud: SolicitudDeAlta,
  diagnostico: DiagnosticoDelAlta
): Promise<ResultadoDelAlta> {
  const plazo = Date.now() + LIMITE_TOTAL_DEL_ALTA_MS

  const previo = await comprobacionPrevia(admin, solicitud, diagnostico)
  if (previo) return previo

  // Queda en verdadero si algún intento pudo haber confirmado sin que lo
  // sepamos. Mientras sea verdadero, ninguna lectura vacía prueba ausencia.
  let quedoAlgoSinResolver = false

  for (let numero = 1; numero <= MAXIMO_DE_INTENTOS; numero += 1) {
    if (numero > 1) {
      const espera = ESPERAS_ENTRE_INTENTOS_MS[numero - 2] ?? 750
      if (Date.now() + espera >= plazo) break
      await esperar(espera)
    }

    const observacion = await intentarAlta(admin, solicitud)
    const registro: DiagnosticoDelAlta['intentos'][number] = {
      numero,
      observacion: observacion.clase,
      estadoHttp: 'estadoHttp' in observacion ? observacion.estadoHttp : null,
      codigoAuth: 'codigoAuth' in observacion ? observacion.codigoAuth : null,
    }
    diagnostico.intentos.push(registro)

    switch (observacion.clase) {
      case 'confirmada': {
        // GoTrue confirmó la cuenta, y el trigger de la migración 010 crea el
        // perfil en esa misma transacción. Esta lectura no reemplaza esa
        // garantía: la comprueba. Si el trigger faltara, o si una versión de
        // GoTrue escribiera `app_metadata` fuera de la transacción, la cuenta
        // quedaría sin perfil, y eso no puede informarse como un alta exitosa.
        const estado = await consultarOperacion(admin, solicitud)
        registro.reconciliacion = estado
        if (estado === 'coherente' || estado === 'desconocido') {
          // Con la lectura sin respuesta, la confirmación de GoTrue y la
          // transacción siguen siendo la garantía. La ruta registra el caso.
          return { tipo: 'confirmada', userId: observacion.userId, reconciliada: false }
        }
        // Ausente, incompatible o inconsistente justo después de confirmar: la
        // garantía se rompió. Se informa sin borrar ni inventar nada.
        return { tipo: 'error', codigo: 'ESTADO_INCONSISTENTE' }
      }

      case 'datos':
        // GoTrue valida antes de abrir la transacción: un intento en vuelo con
        // los mismos datos tendría el mismo rechazo.
        return { tipo: 'error', codigo: observacion.codigo }

      case 'configuracion':
        return {
          tipo: 'error',
          codigo: quedoAlgoSinResolver ? 'ALTA_SIN_CONFIRMAR' : 'SERVICIO_NO_DISPONIBLE',
        }

      case 'transporte':
      case 'frecuencia':
        if (observacion.clase === 'transporte') quedoAlgoSinResolver = true
        continue

      case 'explicita': {
        const estado = await consultarOperacion(admin, solicitud)
        registro.reconciliacion = estado

        const concluyente = resultadoDeLaConsulta(estado, solicitud)
        if (concluyente) return concluyente

        if (estado === 'desconocido') {
          quedoAlgoSinResolver = true
          continue
        }

        // Ausente por `id`. Si GoTrue dijo que el email existe, pertenece a otra
        // cuenta ya confirmada: la de esta operación la habría encontrado la
        // consulta. Un intento en vuelo con este email también sería rechazado.
        if (observacion.codigoAuth === 'email_exists') {
          return { tipo: 'error', codigo: 'EMAIL_DUPLICADO' }
        }

        const titulares = await buscarTitulares(admin, solicitud)
        registro.titulares = titulares.tipo === 'ocupados'
          ? `${titulares.codigo}${titulares.propio ? '-propio' : ''}`
          : titulares.tipo

        if (titulares.tipo === 'desconocido') {
          quedoAlgoSinResolver = true
          continue
        }
        if (titulares.tipo === 'ocupados') {
          if (!titulares.propio) return { tipo: 'error', codigo: titulares.codigo }
          // El DNI es de esta operación: confirmó entre la consulta y ahora.
          const final = await consultarOperacion(admin, solicitud)
          registro.reconciliacion = final
          const cierre = resultadoDeLaConsulta(final, solicitud)
          if (cierre) return cierre
          quedoAlgoSinResolver = true
          continue
        }

        // Rechazo sin causa visible. Puede ser transitorio: se reintenta con
        // el mismo `id`, que es seguro.
        continue
      }
    }
  }

  // Se agotaron los intentos o el plazo sin una conclusión.
  if (quedoAlgoSinResolver) {
    // Algún intento pudo haber confirmado sin que lo sepamos. No se afirma
    // ausencia y no se toca nada: reintentar con la misma operación converge.
    return { tipo: 'error', codigo: 'ALTA_SIN_CONFIRMAR' }
  }
  if (diagnostico.intentos.every((intento) => intento.observacion === 'frecuencia')) {
    // GoTrue no procesó ningún intento.
    return { tipo: 'error', codigo: 'SERVICIO_NO_DISPONIBLE' }
  }
  // Todos los intentos procesados terminaron en un rechazo explícito, y la
  // consulta posterior a cada uno confirmó que no quedó nada.
  return { tipo: 'error', codigo: 'ALTA_RECHAZADA' }
}
