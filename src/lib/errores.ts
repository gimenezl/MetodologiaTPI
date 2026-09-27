/**
 * Errores de dominio de Usuarios y Alumnos (EPT-9).
 *
 * Una sola fuente para lo que una persona puede leer cuando algo falla.
 *
 * La regla es estricta: la interfaz y las respuestas de la API muestran
 * únicamente mensajes de este catálogo, en español profesional. Nunca un
 * mensaje de PostgREST, de PostgreSQL o de Auth; nunca un SQLSTATE, un código
 * `PGRST`, el nombre de una tabla o de una restricción, una URL interna o una
 * traza. Esos mensajes están en inglés, no le dicen nada útil a una directora y
 * sí le cuentan a cualquiera cómo está armada la base.
 *
 * El detalle técnico se registra del lado del servidor. En el navegador solo se
 * registra el código de dominio, que no revela nada que la pantalla no diga.
 *
 * Este módulo no importa nada de servidor ni de cliente: lo usan los dos.
 */

export type CodigoDeError =
  | 'NO_AUTENTICADO'
  | 'SIN_PERMISO'
  | 'CUERPO_INVALIDO'
  | 'DATOS_INVALIDOS'
  | 'VINCULO_NO_DISPONIBLE'
  | 'ROL_INEXISTENTE'
  | 'DNI_DUPLICADO'
  | 'LEGAJO_DUPLICADO'
  | 'EMAIL_DUPLICADO'
  | 'CONTRASENA_RECHAZADA'
  | 'OPERACION_REUTILIZADA'
  | 'ALTA_RECHAZADA'
  | 'ALTA_SIN_CONFIRMAR'
  | 'ESTADO_INCONSISTENTE'
  | 'SIN_CAMBIOS'
  | 'CARGA_FALLIDA'
  | 'SERVICIO_NO_DISPONIBLE'
  | 'ERROR_INESPERADO'
  // Usuarios, roles, acceso y vínculo de cuentas (EPT-59)
  | 'ACCESO_BLOQUEADO'
  | 'OPERACION_PROPIA'
  | 'PERFIL_INEXISTENTE'
  | 'MOTIVO_INVALIDO'
  | 'ROL_INVALIDO'
  | 'MISMO_VALOR'
  | 'TRANSICION_ESTUDIANTE'
  | 'VALOR_OBSOLETO'
  | 'PADRE_CON_VINCULOS'
  | 'DOCENTE_CON_ASIGNACIONES'
  | 'ULTIMO_DIRECTOR'
  | 'DIRECTOR_SIN_CUENTA'
  | 'AUTH_PENDIENTE'
  | 'VINCULO_DESHABILITADO'
  | 'RESERVA_INVALIDA'
  | 'RESERVA_REUTILIZADA'
  | 'RESERVA_EN_CURSO'
  | 'RESERVA_VENCIDA'
  | 'CUENTA_EXISTENTE'
  | 'PERFIL_BLOQUEADO'
  | 'ROL_SIN_VINCULO'
  | 'DNI_NO_COINCIDE'
  | 'CORREO_INVALIDO'
  | 'CORREO_DISTINTO'
  | 'RESERVA_INEXISTENTE'
  | 'CORREO_EN_USO'
  | 'LIMITE_DE_ENVIOS'
  | 'RESERVA_NO_VIGENTE'
  | 'RESERVA_DE_OTRO_DIRECTOR'
  | 'SIN_CODIGO_VIGENTE'
  | 'CORREO_SIN_VERIFICAR'
  | 'CODIGO_INCORRECTO'
  | 'CODIGO_VENCIDO'
  | 'CODIGO_SIN_INTENTOS'
  | 'ENVIO_FALLIDO'
  | 'VINCULO_RECHAZADO'
  | 'VINCULO_SIN_CONFIRMAR'

type EntradaDelCatalogo = {
  /** Estado HTTP con el que la API responde este error. */
  estado: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503
  mensaje: string
}

export const CATALOGO_DE_ERRORES: Readonly<Record<CodigoDeError, EntradaDelCatalogo>> = {
  NO_AUTENTICADO: {
    estado: 401,
    mensaje: 'Necesitás iniciar sesión para continuar.',
  },
  SIN_PERMISO: {
    estado: 403,
    mensaje: 'No tenés permiso para realizar esta operación.',
  },
  CUERPO_INVALIDO: {
    estado: 400,
    mensaje: 'La solicitud no tiene un formato válido.',
  },
  DATOS_INVALIDOS: {
    estado: 400,
    mensaje: 'Revisá los datos ingresados.',
  },
  VINCULO_NO_DISPONIBLE: {
    estado: 400,
    mensaje:
      'Los vínculos entre padres o tutores e hijos todavía no están disponibles. ' +
      'Creá la cuenta sin vincular y registrá la relación cuando la funcionalidad esté publicada.',
  },
  ROL_INEXISTENTE: {
    estado: 422,
    mensaje: 'El rol elegido no existe. Actualizá la página y elegí otro.',
  },
  DNI_DUPLICADO: {
    estado: 409,
    mensaje: 'Ya existe una persona registrada con ese DNI.',
  },
  LEGAJO_DUPLICADO: {
    estado: 409,
    mensaje: 'Ya existe un legajo con ese número.',
  },
  EMAIL_DUPLICADO: {
    estado: 409,
    mensaje: 'Ya existe una cuenta con ese email.',
  },
  CONTRASENA_RECHAZADA: {
    estado: 422,
    mensaje: 'La contraseña no cumple los requisitos de seguridad. Elegí una más larga o más compleja.',
  },
  OPERACION_REUTILIZADA: {
    estado: 409,
    mensaje:
      'Este envío ya se registró con otros datos. Revisá el listado de usuarios y, si hace falta, ' +
      'volvé a cargar el formulario desde cero.',
  },
  ALTA_RECHAZADA: {
    estado: 422,
    mensaje: 'No se pudo crear la cuenta con estos datos. No se guardó ningún dato.',
  },
  ALTA_SIN_CONFIRMAR: {
    estado: 503,
    mensaje:
      'No pudimos confirmar si la cuenta se creó. No se borró ningún dato. Revisá el listado de ' +
      'usuarios antes de volver a intentarlo: si reintentás desde este mismo formulario, la cuenta ' +
      'no se duplica.',
  },
  ESTADO_INCONSISTENTE: {
    estado: 500,
    mensaje:
      'Encontramos la cuenta en un estado que no esperábamos y no la modificamos. ' +
      'Avisale al equipo técnico con la referencia.',
  },
  SIN_CAMBIOS: {
    estado: 409,
    mensaje:
      'No se guardaron los cambios: el registro ya no existe o tu perfil no puede modificarlo desde este panel.',
  },
  CARGA_FALLIDA: {
    estado: 503,
    mensaje: 'No pudimos cargar la información. Intentá nuevamente.',
  },
  SERVICIO_NO_DISPONIBLE: {
    estado: 503,
    mensaje: 'El servicio no está disponible en este momento. Volvé a intentarlo en unos minutos.',
  },
  ERROR_INESPERADO: {
    estado: 500,
    mensaje: 'No pudimos completar la operación. Volvé a intentarlo en unos minutos.',
  },

  // ---- Usuarios, roles, acceso y vínculo de cuentas (EPT-59) ----
  ACCESO_BLOQUEADO: {
    estado: 403,
    mensaje: 'Tu acceso está bloqueado. Comunicate con Dirección.',
  },
  OPERACION_PROPIA: {
    estado: 403,
    mensaje: 'No podés cambiar el rol ni el acceso de tu propia cuenta. Pedíselo a otra persona de Dirección.',
  },
  PERFIL_INEXISTENTE: {
    estado: 404,
    mensaje: 'La persona solicitada no existe. Actualizá el listado de usuarios.',
  },
  MOTIVO_INVALIDO: {
    estado: 422,
    mensaje: 'Escribí un motivo de entre 5 y 500 caracteres.',
  },
  ROL_INVALIDO: {
    estado: 422,
    mensaje: 'El rol o el estado elegido no es válido. Actualizá la página y elegí otro.',
  },
  MISMO_VALOR: {
    estado: 422,
    mensaje: 'La persona ya tiene ese rol o ese estado de acceso. No hay nada que cambiar.',
  },
  TRANSICION_ESTUDIANTE: {
    estado: 422,
    mensaje:
      'El rol ESTUDIANTE no se asigna ni se quita desde Usuarios: depende del legajo académico. ' +
      'Gestionalo desde Alumnos.',
  },
  VALOR_OBSOLETO: {
    estado: 409,
    mensaje:
      'Los datos cambiaron mientras los consultabas. Actualizá la página, revisá el estado actual y ' +
      'volvé a intentarlo si todavía corresponde.',
  },
  PADRE_CON_VINCULOS: {
    estado: 409,
    mensaje:
      'La persona tiene hijos vinculados. Quitá esos vínculos antes de cambiarle el rol.',
  },
  DOCENTE_CON_ASIGNACIONES: {
    estado: 409,
    mensaje:
      'La ficha docente está activa o tiene materias o grupos a cargo. Reasigná esas relaciones e ' +
      'inactivá la ficha antes de cambiarle el rol.',
  },
  ULTIMO_DIRECTOR: {
    estado: 409,
    mensaje:
      'La institución se quedaría sin una persona de Dirección con acceso. Habilitá otra cuenta de ' +
      'Dirección antes de hacer este cambio.',
  },
  DIRECTOR_SIN_CUENTA: {
    estado: 409,
    mensaje:
      'Solo una persona con cuenta confirmada puede recibir el rol DIRECTOR. Para registrar a un ' +
      'Director nuevo, usá el alta con cuenta.',
  },
  AUTH_PENDIENTE: {
    estado: 503,
    mensaje:
      'No pudimos actualizar la cuenta de acceso y no se guardó ningún cambio. Volvé a intentarlo ' +
      'en unos minutos.',
  },
  VINCULO_DESHABILITADO: {
    estado: 503,
    mensaje:
      'La vinculación presencial de cuentas no está habilitada en este servidor: falta configurar el ' +
      'envío de correos. Pedile al equipo técnico que la active.',
  },
  RESERVA_INVALIDA: {
    estado: 422,
    mensaje:
      'Confirmá que verificaste presencialmente el documento y revisá la modalidad y el DNI del ' +
      'representante.',
  },
  RESERVA_REUTILIZADA: {
    estado: 409,
    mensaje: 'Esta operación ya se usó con otros datos. Iniciá una vinculación nueva.',
  },
  RESERVA_EN_CURSO: {
    estado: 409,
    mensaje:
      'La persona ya tiene una vinculación de cuenta en curso. Esperá a que venza o cancelala antes ' +
      'de iniciar otra.',
  },
  RESERVA_VENCIDA: {
    estado: 409,
    mensaje: 'La vinculación venció. Iniciá una operación nueva.',
  },
  CUENTA_EXISTENTE: {
    estado: 409,
    mensaje: 'La persona ya tiene una cuenta de acceso.',
  },
  PERFIL_BLOQUEADO: {
    estado: 409,
    mensaje: 'La persona tiene el acceso bloqueado. Reactivala antes de vincular una cuenta.',
  },
  ROL_SIN_VINCULO: {
    estado: 422,
    mensaje:
      'Solo se puede vincular una cuenta a una persona con un rol asignado distinto de DIRECTOR.',
  },
  DNI_NO_COINCIDE: {
    estado: 422,
    mensaje: 'El DNI ingresado no coincide con el del legajo. Revisá el documento presentado.',
  },
  CORREO_INVALIDO: {
    estado: 422,
    mensaje: 'El correo no tiene un formato válido.',
  },
  CORREO_DISTINTO: {
    estado: 409,
    mensaje:
      'Esta vinculación ya tiene otro correo. Cancelala e iniciá una operación nueva para usar uno ' +
      'distinto.',
  },
  RESERVA_INEXISTENTE: {
    estado: 404,
    mensaje: 'La vinculación solicitada no existe.',
  },
  CORREO_EN_USO: {
    estado: 409,
    mensaje: 'Ese correo ya está en uso. Pedile a la persona otro correo.',
  },
  LIMITE_DE_ENVIOS: {
    estado: 429,
    mensaje:
      'Se alcanzó el límite de envíos de código para esta vinculación. Cancelala e iniciá una nueva.',
  },
  RESERVA_NO_VIGENTE: {
    estado: 409,
    mensaje: 'La vinculación ya no está vigente. Iniciá una operación nueva.',
  },
  RESERVA_DE_OTRO_DIRECTOR: {
    estado: 409,
    mensaje:
      'Esta vinculación la inició otra persona de Dirección, o quien la inició ya no tiene acceso. ' +
      'Iniciá una operación nueva.',
  },
  SIN_CODIGO_VIGENTE: {
    estado: 409,
    mensaje: 'No hay un código vigente. Enviá un código nuevo.',
  },
  CORREO_SIN_VERIFICAR: {
    estado: 409,
    mensaje: 'El correo todavía no fue verificado. Ingresá el código que recibió la persona.',
  },
  CODIGO_INCORRECTO: {
    estado: 422,
    mensaje: 'El código no es correcto.',
  },
  CODIGO_VENCIDO: {
    estado: 409,
    mensaje: 'El código venció. Enviá un código nuevo.',
  },
  CODIGO_SIN_INTENTOS: {
    estado: 429,
    mensaje: 'Se agotaron los intentos para este código. Enviá un código nuevo.',
  },
  ENVIO_FALLIDO: {
    estado: 502,
    mensaje:
      'No pudimos enviar el código por correo. El código no enviado quedó anulado: volvé a ' +
      'intentarlo en unos minutos.',
  },
  VINCULO_RECHAZADO: {
    estado: 409,
    mensaje:
      'No se pudo vincular la cuenta: la vinculación ya no lo permite. No se creó ninguna cuenta. ' +
      'Revisá el estado de la persona e iniciá una operación nueva si todavía corresponde.',
  },
  VINCULO_SIN_CONFIRMAR: {
    estado: 503,
    mensaje:
      'No pudimos confirmar si la cuenta quedó vinculada. No se borró ningún dato. Volvé a ' +
      'intentarlo con el mismo código: la cuenta no se duplica.',
  },
}

const CODIGOS = new Set(Object.keys(CATALOGO_DE_ERRORES))

export function esCodigoDeError(valor: unknown): valor is CodigoDeError {
  return typeof valor === 'string' && CODIGOS.has(valor)
}

/** Formato de la referencia técnica: un UUID aleatorio, sin datos personales. */
const PATRON_REFERENCIA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

export function esReferenciaValida(valor: unknown): valor is string {
  return typeof valor === 'string' && PATRON_REFERENCIA.test(valor)
}

export class ErrorDeDominio extends Error {
  readonly codigo: CodigoDeError
  readonly estado: number
  /** Identificador para encontrar el episodio en el registro del servidor. */
  readonly referencia: string | null
  /** Campo del formulario al que corresponde, si corresponde a uno. */
  readonly campo: string | null

  constructor(
    codigo: CodigoDeError,
    opciones: { mensaje?: string; referencia?: string | null; campo?: string | null } = {}
  ) {
    super(opciones.mensaje ?? CATALOGO_DE_ERRORES[codigo].mensaje)
    this.name = 'ErrorDeDominio'
    this.codigo = codigo
    this.estado = CATALOGO_DE_ERRORES[codigo].estado
    this.referencia = esReferenciaValida(opciones.referencia) ? opciones.referencia : null
    this.campo = opciones.campo ?? null
  }
}

/**
 * El único mensaje que la interfaz puede mostrar ante un error.
 *
 * Un error de dominio trae un mensaje del catálogo. Cualquier otra cosa —un
 * `TypeError` de red, un error de PostgREST, una excepción inesperada— se
 * reemplaza por el respaldo que elige la pantalla, que también es un mensaje
 * profesional en español. Así ningún camino imprevisto termina en el DOM.
 */
export function mensajeParaMostrar(error: unknown, respaldo: string): string {
  if (!(error instanceof ErrorDeDominio)) return respaldo
  return error.referencia ? `${error.message} Referencia: ${error.referencia}.` : error.message
}

/**
 * Reconstruye el error de dominio a partir de la respuesta JSON de nuestra API.
 *
 * Solo se confía en el texto de `error` cuando la respuesta trae un `codigo` del
 * catálogo: eso prueba que la escribió nuestra ruta y no un intermediario que
 * devolvió su propia página de error. Sin código conocido se usa el mensaje del
 * catálogo que corresponde al estado HTTP, nunca el texto recibido.
 */
export function errorDesdeRespuesta(cuerpo: unknown, estadoHttp: number): ErrorDeDominio {
  const datos = (typeof cuerpo === 'object' && cuerpo !== null ? cuerpo : {}) as Record<
    string,
    unknown
  >

  if (esCodigoDeError(datos.codigo)) {
    return new ErrorDeDominio(datos.codigo, {
      mensaje: typeof datos.error === 'string' && datos.error ? datos.error : undefined,
      referencia: esReferenciaValida(datos.referencia) ? datos.referencia : null,
      campo: typeof datos.campo === 'string' ? datos.campo : null,
    })
  }

  if (estadoHttp === 401) return new ErrorDeDominio('NO_AUTENTICADO')
  if (estadoHttp === 403) return new ErrorDeDominio('SIN_PERMISO')
  if (estadoHttp === 502 || estadoHttp === 503 || estadoHttp === 504) {
    return new ErrorDeDominio('SERVICIO_NO_DISPONIBLE')
  }
  return new ErrorDeDominio('ERROR_INESPERADO')
}

// ================================================================
// Errores de PostgREST y PostgreSQL
// ================================================================

/** Lo mínimo que tiene un error de PostgREST: siempre `code` y `message`. */
export type ErrorDeConsulta = {
  code: string
  message: string
  details?: string | null
  hint?: string | null
}

/**
 * Comprueba que un valor tenga la forma real de un error de PostgREST.
 *
 * No alcanza con que «parezca» un error: sin `code` y `message` como cadenas no
 * hay nada que clasificar con certeza, y quien clasifica tiene que fallar
 * cerrado.
 */
export function esErrorDeConsulta(valor: unknown): valor is ErrorDeConsulta {
  if (typeof valor !== 'object' || valor === null) return false
  const posible = valor as Record<string, unknown>
  return typeof posible.code === 'string' && typeof posible.message === 'string'
}

/** Nombre exacto de la restricción única violada, si el mensaje la nombra. */
export function restriccionUnicaViolada(error: ErrorDeConsulta): string | null {
  const coincidencia = /^duplicate key value violates unique constraint "([^"]+)"$/u.exec(
    error.message
  )
  return coincidencia ? coincidencia[1] : null
}

/** Nombre exacto de la restricción CHECK violada, si el mensaje la nombra. */
export function restriccionCheckViolada(error: ErrorDeConsulta): string | null {
  const coincidencia =
    /^new row for relation "[^"]+" violates check constraint "([^"]+)"$/u.exec(error.message)
  return coincidencia ? coincidencia[1] : null
}

/**
 * Traduce el error de una escritura sobre `perfiles` hecha desde el navegador.
 *
 * Las restricciones se reconocen por su nombre exacto, nunca por una subcadena:
 * `perfiles_dni_key` es el DNI y nada más. Lo que no se reconoce con certeza
 * cae en un mensaje genérico, que es honesto aunque sea menos preciso.
 */
export function traducirErrorDeEscrituraDePerfil(error: unknown): ErrorDeDominio {
  if (!esErrorDeConsulta(error)) return new ErrorDeDominio('SERVICIO_NO_DISPONIBLE')

  switch (error.code) {
    case '23505': {
      const restriccion = restriccionUnicaViolada(error)
      if (restriccion === 'perfiles_dni_key') {
        return new ErrorDeDominio('DNI_DUPLICADO', { campo: 'dni' })
      }
      if (
        restriccion === 'perfiles_legajo_nro_key' ||
        restriccion === 'idx_perfiles_legajo_normalizado'
      ) {
        return new ErrorDeDominio('LEGAJO_DUPLICADO', { campo: 'legajo_nro' })
      }
      return new ErrorDeDominio('DATOS_INVALIDOS', {
        mensaje: 'Alguno de los datos ya está registrado para otra persona.',
      })
    }
    case '23514': {
      const restriccion = restriccionCheckViolada(error)
      if (restriccion === 'perfiles_dni_valido') {
        return new ErrorDeDominio('DATOS_INVALIDOS', {
          mensaje: 'El DNI debe tener exactamente 7 u 8 dígitos, sin puntos ni letras.',
          campo: 'dni',
        })
      }
      if (restriccion === 'perfiles_legajo_valido') {
        return new ErrorDeDominio('DATOS_INVALIDOS', {
          mensaje:
            'El número de legajo debe tener entre 1 y 50 caracteres, sin espacios al inicio o al final.',
          campo: 'legajo_nro',
        })
      }
      return new ErrorDeDominio('DATOS_INVALIDOS')
    }
    case '23503':
      return new ErrorDeDominio('ROL_INEXISTENTE', { campo: 'rol_id' })
    case 'P5512':
      return new ErrorDeDominio('DATOS_INVALIDOS', {
        mensaje: 'Un estudiante activo debe conservar su número de legajo.',
        campo: 'legajo_nro',
      })
    case '42501':
      return new ErrorDeDominio('SIN_PERMISO')
    // `.single()` sobre cero filas: RLS no dejó modificar el registro o ya no
    // existe. No hubo ningún cambio, y la pantalla tiene que decirlo.
    case 'PGRST116':
      return new ErrorDeDominio('SIN_CAMBIOS')
    // Sin código: el pedido ni siquiera obtuvo respuesta de la base.
    case '':
      return new ErrorDeDominio('SERVICIO_NO_DISPONIBLE')
    default:
      return new ErrorDeDominio('ERROR_INESPERADO')
  }
}

/**
 * Traduce el error de una lectura hecha desde el navegador.
 *
 * Una lectura fallida nunca se disfraza de lista vacía: se informa como carga
 * fallida, con un mensaje estable. El código técnico se conserva solo para el
 * registro.
 */
export function traducirErrorDeLectura(error: unknown): ErrorDeDominio {
  if (esErrorDeConsulta(error) && error.code === '42501') {
    return new ErrorDeDominio('SIN_PERMISO')
  }
  return new ErrorDeDominio('CARGA_FALLIDA')
}

/**
 * SQLSTATE propios de EPT-59 (y los reutilizados) → código de dominio.
 *
 * La base es la fuente de verdad: cada código sale de un `RAISE EXCEPTION` de
 * la migración `20260926190000_ept_59_usuarios_permisos.sql`. El mensaje de
 * PostgreSQL nunca se reenvía; solo se usa el SQLSTATE.
 *
 * P5908 (historial de solo agregado) y P5939 (las reservas no se borran) no
 * figuran: ninguna operación de la API puede provocarlos, y si aparecieran
 * serían un error inesperado. P5940–P5947 nacen dentro de la transacción de
 * GoTrue y llegan como un 500 genérico de Auth, no como SQLSTATE: se resuelven
 * reconciliando con `datos_para_enlace`. P5944 sí llega por PostgREST cuando
 * `datos_para_enlace` se consulta antes de verificar el correo.
 */
const CODIGOS_DE_USUARIOS: Readonly<Record<string, CodigoDeError>> = {
  P5505: 'NO_AUTENTICADO',
  '42501': 'SIN_PERMISO',
  P5901: 'MOTIVO_INVALIDO',
  P5902: 'ROL_INVALIDO',
  P5903: 'OPERACION_PROPIA',
  P5904: 'PERFIL_INEXISTENTE',
  P5906: 'MISMO_VALOR',
  P5907: 'TRANSICION_ESTUDIANTE',
  P5909: 'VALOR_OBSOLETO',
  P5910: 'PADRE_CON_VINCULOS',
  P5911: 'DOCENTE_CON_ASIGNACIONES',
  P5912: 'ULTIMO_DIRECTOR',
  P5913: 'DIRECTOR_SIN_CUENTA',
  P5920: 'RESERVA_INVALIDA',
  P5921: 'RESERVA_REUTILIZADA',
  P5922: 'RESERVA_EN_CURSO',
  P5923: 'RESERVA_VENCIDA',
  P5924: 'CUENTA_EXISTENTE',
  P5925: 'PERFIL_BLOQUEADO',
  P5926: 'ROL_SIN_VINCULO',
  P5927: 'DNI_NO_COINCIDE',
  P5928: 'CORREO_INVALIDO',
  P5929: 'CORREO_DISTINTO',
  P5930: 'RESERVA_INEXISTENTE',
  P5931: 'CORREO_EN_USO',
  P5932: 'LIMITE_DE_ENVIOS',
  P5933: 'RESERVA_NO_VIGENTE',
  P5935: 'RESERVA_DE_OTRO_DIRECTOR',
  P5936: 'SIN_CODIGO_VIGENTE',
  P5944: 'CORREO_SIN_VERIFICAR',
}

/**
 * Traduce el error de una RPC de Usuarios (EPT-59) a un error de dominio.
 *
 * Lo que no se reconoce con certeza cae en un mensaje genérico: un error sin
 * forma de PostgREST o sin código es un problema de servicio, y un SQLSTATE
 * ajeno al contrato es inesperado. Nunca se devuelve el texto de la base.
 */
export function traducirErrorDeUsuarios(error: unknown): ErrorDeDominio {
  if (!esErrorDeConsulta(error) || error.code === '') {
    return new ErrorDeDominio('SERVICIO_NO_DISPONIBLE')
  }
  const codigo = CODIGOS_DE_USUARIOS[error.code]
  return new ErrorDeDominio(codigo ?? 'ERROR_INESPERADO')
}

/**
 * Lo único que se registra en el navegador sobre un error: su código de dominio.
 *
 * El detalle técnico de una consulta hecha desde el navegador ya viaja en la
 * respuesta HTTP; repetirlo en la consola no agrega diagnóstico y sí lo acerca
 * a una captura de pantalla. El código de dominio alcanza para saber qué falló.
 */
export function registroSeguro(error: unknown): { codigo: string } {
  return { codigo: error instanceof ErrorDeDominio ? error.codigo : 'NO_CLASIFICADO' }
}
