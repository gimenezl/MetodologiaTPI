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

type EntradaDelCatalogo = {
  /** Estado HTTP con el que la API responde este error. */
  estado: 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503
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
 * Lo único que se registra en el navegador sobre un error: su código de dominio.
 *
 * El detalle técnico de una consulta hecha desde el navegador ya viaja en la
 * respuesta HTTP; repetirlo en la consola no agrega diagnóstico y sí lo acerca
 * a una captura de pantalla. El código de dominio alcanza para saber qué falló.
 */
export function registroSeguro(error: unknown): { codigo: string } {
  return { codigo: error instanceof ErrorDeDominio ? error.codigo : 'NO_CLASIFICADO' }
}
