import { z } from 'zod'

// ---- DNI Validation ----
const dniSchema = z
  .string()
  .min(1, 'El DNI es requerido')
  .regex(/^\d{7,8}$/, 'El DNI debe tener entre 7 y 8 dígitos numéricos')

// ---- Email Validation ----
const emailSchema = z
  .string()
  .min(1, 'El email es requerido')
  .email('Ingresá un email válido')

// ---- Phone Validation ----
const telefonoSchema = z
  .string()
  .min(1, 'El teléfono es requerido')
  .regex(/^[\d\s\-\+\(\)]{8,20}$/, 'Ingresá un teléfono válido (ej: 0362 4123456)')

// ---- Name Validation ----
const nombreSchema = z
  .string()
  .min(2, 'Mínimo 2 caracteres')
  .max(100, 'Máximo 100 caracteres')
  .regex(/^[a-zA-ZÀ-ÿ\s'-]+$/, 'Solo se permiten letras y espacios')

// ---- Edad en años a partir de una fecha ISO ----
function edadEnAnios(val: string): number {
  const nacimiento = new Date(val)
  const diffMs = Date.now() - nacimiento.getTime()
  return diffMs / (1000 * 60 * 60 * 24 * 365.25)
}

// ---- Fecha genérica: no futura y dentro de un rango razonable (≤ 100 años) ----
const fechaNacimientoSchema = z
  .string()
  .min(1, 'La fecha de nacimiento es requerida')
  .refine((val) => new Date(val) < new Date(), 'La fecha no puede ser en el futuro')
  .refine((val) => edadEnAnios(val) <= 100, 'Ingresá una fecha de nacimiento válida')

// ---- Fecha del aspirante: debe corresponder a edad escolar (2 a 20 años) ----
const fechaNacimientoAspiranteSchema = z
  .string()
  .min(1, 'La fecha de nacimiento es requerida')
  .refine((val) => new Date(val) < new Date(), 'La fecha no puede ser en el futuro')
  .refine((val) => {
    const edad = edadEnAnios(val)
    return edad >= 2 && edad <= 20
  }, 'La edad del aspirante debe estar entre 2 y 20 años')

// ---- Enrollment Form Schema (multi-step) ----
export const inscripcionSchema = z.object({
  // Step 1: Aspirante
  nombre: nombreSchema,
  apellido: nombreSchema,
  dni: dniSchema,
  fecha_nacimiento: fechaNacimientoAspiranteSchema,
  nivel: z.enum(['INICIAL', 'PRIMARIO', 'SECUNDARIO'] as const, {
    message: 'Seleccioná un nivel educativo',
  }),

  // Step 2: Contacto
  email: emailSchema,
  telefono: telefonoSchema,
  direccion: z.string().min(5, 'Ingresá una dirección completa').max(255),

  // Step 3: Responsable / Datos adicionales
  nombre_responsable: nombreSchema,
  apellido_responsable: nombreSchema,
  dni_responsable: dniSchema,
  telefono_responsable: telefonoSchema,
  relacion_responsable: z.enum(['PADRE', 'MADRE', 'TUTOR'] as const, {
    message: 'Seleccioná la relación con el aspirante',
  }),
  actividades_interes: z.array(z.string()).optional(),
  informacion_adicional: z.string().max(500, 'Máximo 500 caracteres').optional(),
  acepta_terminos: z.literal(true, {
    message: 'Debés aceptar los términos y condiciones',
  }),
})

export type InscripcionFormData = z.infer<typeof inscripcionSchema>

// ---- Login Schema ----
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
})

export type LoginFormData = z.infer<typeof loginSchema>

// ---- Opinion Schema ----
export const opinionSchema = z.object({
  nombre_usuario: z.string().max(100).optional(),
  comentario: z
    .string()
    .min(10, 'El comentario debe tener al menos 10 caracteres')
    .max(500, 'Máximo 500 caracteres'),
})

export type OpinionFormData = z.infer<typeof opinionSchema>

// ---- Profile Schema ----
export const perfilSchema = z.object({
  nombre: nombreSchema,
  apellido: nombreSchema,
  dni: dniSchema,
  fecha_nacimiento: fechaNacimientoSchema.optional(),
  telefono: telefonoSchema.optional(),
  direccion: z.string().max(255).optional(),
  legajo_nro: z.string().max(50).optional(),
  rol_id: z.number().int().positive(),
})

export type PerfilFormData = z.infer<typeof perfilSchema>

// ---- Cursos (EPT-8) ----
/**
 * Normalización canónica de los textos de un curso.
 *
 * Debe coincidir exactamente con la expresión del índice único de la base
 * (`UPPER(BTRIM(...))` en `idx_cursos_nivel_denominacion_division`). Se usa
 * solo para comparar; lo que se guarda es el valor recortado tal como lo
 * escribió el director, para no alterar su forma de nombrar los cursos.
 *
 * La base sigue siendo la única autoridad ante concurrencia: esta función
 * mejora los mensajes, no reemplaza la restricción única.
 */
export function normalizarTextoCurso(valor: string): string {
  return valor.trim().toUpperCase()
}

const denominacionSchema = z
  .string()
  .trim()
  .min(1, 'La denominación es requerida')
  .max(100, 'Máximo 100 caracteres')

const divisionSchema = z
  .string()
  .trim()
  .min(1, 'La división es requerida')
  .max(20, 'Máximo 20 caracteres')

const nivelIdSchema = z
  .number({ message: 'Seleccioná un nivel educativo' })
  .int('Nivel inválido')
  .positive('Seleccioná un nivel educativo')

export const crearCursoSchema = z.object({
  denominacion: denominacionSchema,
  division: divisionSchema,
  nivel_id: nivelIdSchema,
})

export type CrearCursoData = z.infer<typeof crearCursoSchema>

/**
 * Modificación parcial. `activo` cubre la baja y el alta lógica; no existe
 * ninguna operación de borrado físico.
 */
export const actualizarCursoSchema = z
  .object({
    denominacion: denominacionSchema.optional(),
    division: divisionSchema.optional(),
    nivel_id: nivelIdSchema.optional(),
    activo: z.boolean().optional(),
  })
  .refine(
    (datos) => Object.values(datos).some((valor) => valor !== undefined),
    { message: 'No hay cambios para aplicar' }
  )

export type ActualizarCursoData = z.infer<typeof actualizarCursoSchema>

export const cursoIdSchema = z.string().uuid('Identificador de curso inválido')

// ---- Niveles educativos (EPT-55) ----
/**
 * El nombre se rechaza, no se recorta silenciosamente. Así la validación HTTP
 * coincide con `niveles_nombre_valido` y con las funciones de PostgreSQL.
 */
const caracterEnBlancoLateralNivel = /^[\s\u0085]|[\s\u0085]$/u

export const nombreNivelSchema = z
  .string({ message: 'El nombre del nivel es requerido' })
  .min(1, 'El nombre del nivel es requerido')
  .max(50, 'El nombre del nivel no puede superar los 50 caracteres')
  .refine(
    (nombre) => !caracterEnBlancoLateralNivel.test(nombre),
    'El nombre del nivel no puede tener caracteres en blanco al inicio o al final'
  )

export const crearNivelSchema = z
  .object({ nombre: nombreNivelSchema })
  .strict()

export type CrearNivelData = z.infer<typeof crearNivelSchema>

const renombrarNivelSchema = z
  .object({
    accion: z.literal('renombrar'),
    nombre: nombreNivelSchema,
  })
  .strict()

const cambiarEstadoNivelSchema = z
  .object({
    accion: z.literal('cambiar_estado'),
    activo: z.boolean({ message: 'El estado del nivel debe ser verdadero o falso' }),
  })
  .strict()

/**
 * Contrato PATCH discriminado: cada petición realiza una sola operación y no
 * puede mezclar un renombrado con un cambio de estado.
 */
export const actualizarNivelSchema = z.discriminatedUnion('accion', [
  renombrarNivelSchema,
  cambiarEstadoNivelSchema,
])

export type ActualizarNivelData = z.infer<typeof actualizarNivelSchema>

/** Identificador serial de PostgreSQL representado como segmento de URL. */
export const nivelEducativoIdSchema = z
  .string()
  .regex(/^[1-9]\d*$/, 'Identificador de nivel inválido')
  .transform(Number)
  .refine(
    (id) => Number.isSafeInteger(id) && id <= 2147483647,
    'Identificador de nivel inválido'
  )

/** Traduce también los errores estructurales que Zod emite en inglés. */
export function primerErrorNivel(error: z.ZodError): {
  mensaje: string
  campo?: string
} {
  const issue = error.issues[0]
  const campo = typeof issue?.path?.[0] === 'string' ? issue.path[0] : undefined

  if (!issue) return { mensaje: 'Datos inválidos' }
  if (issue.code === 'unrecognized_keys') {
    return { mensaje: 'La petición contiene campos no permitidos' }
  }
  if (issue.code === 'invalid_union') {
    return { mensaje: 'Seleccioná una acción válida', campo: 'accion' }
  }
  if (issue.code === 'invalid_type' && !campo) {
    return { mensaje: 'Datos inválidos' }
  }

  return { mensaje: issue.message, campo }
}
