import { z } from 'zod'
import { esHoraValida, normalizarHora } from '@/lib/horarios'
import {
  cantidadDeCaracteres,
  ESPECIALIDAD_MAXIMO,
  ESPECIALIDAD_MINIMO,
  MOTIVO_MAXIMO,
  normalizarEspecialidad,
  normalizarMotivo,
} from '@/lib/profesores'

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

// ---- Materias (EPT-56) ----
/**
 * Recorte canónico del nombre de una materia.
 *
 * Cubre exactamente el mismo conjunto de espacios en blanco que
 * `app_private.nombre_materia_valido` en PostgreSQL. `String.prototype.trim()`
 * no alcanza: no quita `U+0085` (next line), que la base sí recorta, así que un
 * nombre aceptado acá terminaría rechazado por la base.
 *
 * A diferencia del nombre de nivel, acá el valor se recorta y no se rechaza: la
 * decisión funcional aprobada define la identidad de la materia como su nombre
 * sin espacios laterales, de modo que recortar no cambia lo que el director
 * quiso escribir.
 */
export function recortarNombreMateria(valor: string): string {
  return valor.replace(/^[\s﻿]+|[\s﻿]+$/gu, '')
}

/**
 * Normalización de comparación, idéntica a la expresión del índice único
 * (`UPPER(BTRIM(nombre))`). Se usa solo para anticipar mensajes en la interfaz;
 * la autoridad ante concurrencia sigue siendo la restricción de la base.
 */
export function normalizarNombreMateria(valor: string): string {
  return recortarNombreMateria(valor).toUpperCase()
}

export const nombreMateriaSchema = z
  .string({ message: 'El nombre de la materia es requerido' })
  .transform(recortarNombreMateria)
  .refine((nombre) => nombre.length >= 1, 'El nombre de la materia es requerido')
  .refine(
    (nombre) => nombre.length <= 100,
    'El nombre de la materia no puede superar los 100 caracteres'
  )

export const crearMateriaSchema = z.object({ nombre: nombreMateriaSchema }).strict()

export type CrearMateriaData = z.infer<typeof crearMateriaSchema>

const renombrarMateriaSchema = z
  .object({ accion: z.literal('renombrar'), nombre: nombreMateriaSchema })
  .strict()

const cambiarEstadoMateriaSchema = z
  .object({
    accion: z.literal('cambiar_estado'),
    activo: z.boolean({ message: 'El estado de la materia debe ser verdadero o falso' }),
  })
  .strict()

/** Contrato PATCH discriminado: una sola operación por petición. */
export const actualizarMateriaSchema = z.discriminatedUnion('accion', [
  renombrarMateriaSchema,
  cambiarEstadoMateriaSchema,
])

export type ActualizarMateriaData = z.infer<typeof actualizarMateriaSchema>

/** Identificador serial de PostgreSQL representado como segmento de URL. */
export const materiaIdSchema = z
  .string()
  .regex(/^[1-9]\d*$/, 'Identificador de materia inválido')
  .transform(Number)
  .refine(
    (id) => Number.isSafeInteger(id) && id <= 2147483647,
    'Identificador de materia inválido'
  )

export const asignacionIdSchema = z
  .string()
  .uuid('Identificador de asignación inválido')

const cursoAsignableMateriaSchema = z
  .string({ message: 'Seleccioná un curso activo' })
  .uuid('Seleccioná un curso activo')

/**
 * El profesor responsable es opcional. `null` es una elección explícita
 * («sin profesor asignado»); la ausencia de la clave equivale a lo mismo.
 */
const profesorResponsableSchema = z
  .string({ message: 'Seleccioná un profesor con rol DOCENTE' })
  .uuid('Seleccioná un profesor con rol DOCENTE')
  .nullable()

export const asignarMateriaSchema = z
  .object({
    materia_id: z
      .number({ message: 'Seleccioná una materia' })
      .int('Seleccioná una materia')
      .positive('Seleccioná una materia'),
    curso_id: cursoAsignableMateriaSchema,
    profesor_id: profesorResponsableSchema.optional(),
  })
  .strict()

export type AsignarMateriaData = z.infer<typeof asignarMateriaSchema>

const cambiarProfesorSchema = z
  .object({
    accion: z.literal('cambiar_profesor'),
    profesor_id: profesorResponsableSchema,
  })
  .strict()

const cambiarEstadoAsignacionSchema = z
  .object({
    accion: z.literal('cambiar_estado'),
    activo: z.boolean({ message: 'El estado de la asignación debe ser verdadero o falso' }),
  })
  .strict()

export const actualizarAsignacionSchema = z.discriminatedUnion('accion', [
  cambiarProfesorSchema,
  cambiarEstadoAsignacionSchema,
])

export type ActualizarAsignacionData = z.infer<typeof actualizarAsignacionSchema>

/** Misma traducción estructural que `primerErrorNivel`, para materias. */
export function primerErrorMateria(error: z.ZodError): {
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

// ---- Alumnos y estado académico (EPT-9) ----
/**
 * El contrato del DNI se rechaza, nunca se recorta. Un DNI con espacios o con
 * letras es un dato personal mal cargado: corregirlo en silencio inventaría la
 * identidad de una persona. La clase se escribe `[0-9]` y no `\d` para que el
 * significado sea el mismo que el de `app_private.dni_valido` en PostgreSQL.
 */
export const dniAlumnoSchema = z
  .string({ message: 'El DNI es requerido' })
  .min(1, 'El DNI es requerido')
  .regex(/^[0-9]{7,8}$/, 'El DNI debe tener exactamente 7 u 8 dígitos, sin puntos ni letras')

/**
 * Espacio en blanco lateral, con el mismo alcance que el contrato de PostgreSQL.
 *
 * `\s` con la bandera `u` cubre todo el conjunto que rechaza la restricción
 * `perfiles_legajo_valido`, salvo `U+0085` (next line), que en JavaScript no
 * cuenta como espacio en blanco y por eso se agrega a mano. Comprobado contra
 * los veintiséis puntos de código enumerados en la migración 009.
 *
 * `String.prototype.trim()` no sirve acá: se comportaría distinto de `btrim`
 * justamente en `U+0085`, y un legajo aceptado por el formulario terminaría
 * rechazado por la base.
 */
const espacioLateralUnicode = /^[\s\u0085]|[\s\u0085]$/u

/**
 * El legajo es manual: no existe numeración automática.
 *
 * Se rechaza, nunca se recorta. Un legajo visualmente vacío o con espacios en
 * blanco Unicode en los extremos es un dato mal cargado; corregirlo en silencio
 * cambiaría el número que escribió una persona. Los espacios interiores se
 * conservan: la descripción aprobada no los prohíbe.
 */
export const legajoAlumnoSchema = z
  .string({ message: 'El número de legajo es requerido' })
  .min(1, 'El número de legajo es requerido')
  .max(50, 'El número de legajo no puede superar los 50 caracteres')
  .refine(
    (legajo) => !espacioLateralUnicode.test(legajo),
    'El número de legajo no puede tener espacios al inicio o al final'
  )
  .refine(
    (legajo) => legajo.trim().length > 0,
    'El número de legajo no puede estar vacío'
  )

const nombrePersonaSchema = z
  .string({ message: 'Este dato es requerido' })
  .min(2, 'Mínimo 2 caracteres')
  .max(100, 'Máximo 100 caracteres')
  .regex(/^[a-zA-ZÀ-ÿ\s'-]+$/, 'Solo se permiten letras y espacios')
  .refine(
    (valor) => valor === valor.trim(),
    'No puede tener espacios al inicio o al final'
  )

export const estadoAlumnoSchema = z.enum(['ACTIVO', 'INACTIVO'] as const, {
  message: 'Elegí explícitamente si el estudiante queda activo o inactivo',
})

export type EstadoAlumno = z.infer<typeof estadoAlumnoSchema>

export const cursoAsignableSchema = z
  .string({ message: 'Seleccioná un curso activo' })
  .uuid('Seleccioná un curso activo')

/**
 * Alta administrativa. El estado es una elección explícita y obligatoria: no hay
 * ningún valor por defecto que oculte una decisión académica.
 *
 * Los campos opcionales se declaran con `.optional()` a secas. Convertir la
 * cadena vacía del formulario en `undefined` es responsabilidad del `setValueAs`
 * de React Hook Form, como en el resto del panel: así el tipo de entrada y el de
 * salida del esquema coinciden y el resolver conserva la inferencia.
 */
export const crearAlumnoSchema = z
  .object({
    nombre: nombrePersonaSchema,
    apellido: nombrePersonaSchema,
    dni: dniAlumnoSchema,
    estado: estadoAlumnoSchema,
    legajo_nro: legajoAlumnoSchema.optional(),
    curso_id: cursoAsignableSchema.optional(),
    fecha_nacimiento: z
      .string()
      .refine((valor) => new Date(valor) < new Date(), 'La fecha no puede ser en el futuro')
      .optional(),
    telefono: z.string().max(20, 'Máximo 20 caracteres').optional(),
    direccion: z.string().max(255, 'Máximo 255 caracteres').optional(),
  })
  .strict()
  .superRefine((datos, ctx) => {
    if (datos.estado === 'ACTIVO') {
      if (!datos.curso_id) {
        ctx.addIssue({
          code: 'custom',
          path: ['curso_id'],
          message: 'Un estudiante activo debe tener un curso asignado',
        })
      }
      if (!datos.legajo_nro) {
        ctx.addIssue({
          code: 'custom',
          path: ['legajo_nro'],
          message: 'Un estudiante activo debe tener un número de legajo',
        })
      }
      return
    }

    if (datos.curso_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['curso_id'],
        message: 'Un estudiante inactivo no puede quedar matriculado en un curso',
      })
    }
  })

export type CrearAlumnoData = z.infer<typeof crearAlumnoSchema>

const corregirIdentidadSchema = z
  .object({
    accion: z.literal('corregir_identidad'),
    dni: dniAlumnoSchema,
    legajo_nro: legajoAlumnoSchema.optional(),
  })
  .strict()

const cambiarCursoSchema = z
  .object({
    accion: z.literal('cambiar_curso'),
    curso_id: cursoAsignableSchema,
  })
  .strict()

const inactivarAlumnoSchema = z
  .object({ accion: z.literal('inactivar') })
  .strict()

const reactivarAlumnoSchema = z
  .object({
    accion: z.literal('reactivar'),
    curso_id: cursoAsignableSchema,
  })
  .strict()

/**
 * Contrato PATCH discriminado: cada petición realiza una sola operación
 * académica. No existe ninguna acción de borrado.
 */
export const actualizarAlumnoSchema = z.discriminatedUnion('accion', [
  corregirIdentidadSchema,
  cambiarCursoSchema,
  inactivarAlumnoSchema,
  reactivarAlumnoSchema,
])

export type ActualizarAlumnoData = z.infer<typeof actualizarAlumnoSchema>

export const alumnoIdSchema = z.string().uuid('Identificador de alumno inválido')

/** Misma traducción estructural que `primerErrorNivel`, para el dominio de alumnos. */
export function primerErrorAlumno(error: z.ZodError): {
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

// ---- Inscripción a servicios escolares (EPT-10) ----

/**
 * El cuerpo del alta solo transporta QUÉ servicio se solicita. Nunca el alumno,
 * el perfil, el usuario ni el legajo: esa identidad la deriva PostgreSQL desde
 * `auth.uid()`. `.strict()` rechaza cualquier intento de agregarla.
 */
export const inscribirEnServicioSchema = z
  .object({
    servicio_id: z
      .string({ message: 'Seleccioná un servicio escolar' })
      .uuid('Seleccioná un servicio escolar'),
  })
  .strict()

export type InscribirEnServicioData = z.infer<typeof inscribirEnServicioSchema>

/**
 * La única acción admitida sobre una inscripción existente es la baja lógica.
 * Se expresa igual que el resto del proyecto, con una unión discriminada, para
 * que agregar otra acción sea una decisión explícita y no un efecto colateral.
 */
export const actualizarInscripcionServicioSchema = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('cancelar') }).strict(),
])

export type ActualizarInscripcionServicioData = z.infer<
  typeof actualizarInscripcionServicioSchema
>

export const inscripcionServicioIdSchema = z
  .string()
  .uuid('Identificador de inscripción inválido')

/** Misma traducción estructural que `primerErrorMateria`, para el comedor. */
export function primerErrorComedor(error: z.ZodError): {
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

// ---- Deportes (EPT-11) ----
/**
 * El alta del alumno solo transporta QUÉ grupo se solicita. Nunca el alumno, su
 * nivel, el cupo ni el estado: PostgreSQL deriva la identidad de `auth.uid()`,
 * el nivel de la matrícula vigente y la disponibilidad con el grupo bloqueado.
 * `.strict()` rechaza cualquier intento de agregar esos campos.
 */
export const inscribirEnGrupoDeportivoSchema = z
  .object({
    grupo_id: z
      .string({ message: 'Seleccioná un grupo deportivo' })
      .uuid('Seleccioná un grupo deportivo'),
  })
  .strict()

export type InscribirEnGrupoDeportivoData = z.infer<typeof inscribirEnGrupoDeportivoSchema>

/** Única acción sobre una inscripción deportiva existente: la baja lógica. */
export const actualizarInscripcionDeportivaSchema = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('cancelar') }).strict(),
])

export const inscripcionDeportivaIdSchema = z
  .string()
  .uuid('Identificador de inscripción inválido')

/**
 * Nombre del grupo. Mismo conjunto de espacios laterales que
 * `app_private.texto_servicio_valido`, que es el que aplica la base; por eso se
 * reutiliza el recorte de materias, que cubre exactamente esos caracteres.
 */
const nombreGrupoDeportivoSchema = z
  .string({ message: 'El nombre del grupo es requerido' })
  .transform(recortarNombreMateria)
  .refine((nombre) => nombre.length >= 1, 'El nombre del grupo es requerido')
  .refine(
    (nombre) => nombre.length <= 100,
    'El nombre del grupo no puede superar los 100 caracteres'
  )

/** Alta mínima de un grupo por la dirección. Mismos límites que la base. */
export const crearGrupoDeportivoSchema = z
  .object({
    deporte_id: z
      .string({ message: 'Seleccioná un deporte' })
      .uuid('Seleccioná un deporte'),
    nivel_id: z
      .number({ message: 'Seleccioná un nivel educativo' })
      .int('Seleccioná un nivel educativo')
      .positive('Seleccioná un nivel educativo')
      .max(2147483647, 'Seleccioná un nivel educativo'),
    nombre: nombreGrupoDeportivoSchema,
    cupo: z
      .number({ message: 'Ingresá el cupo del grupo' })
      .int('El cupo debe ser un número entero')
      .min(1, 'El cupo debe ser de al menos 1 plaza')
      .max(100, 'El cupo no puede superar las 100 plazas'),
    profesor_id: z
      .string({ message: 'Seleccioná un profesor con rol DOCENTE' })
      .uuid('Seleccioná un profesor con rol DOCENTE'),
  })
  .strict()

export type CrearGrupoDeportivoData = z.infer<typeof crearGrupoDeportivoSchema>

/** Misma traducción estructural que `primerErrorComedor`, para deportes. */
export function primerErrorDeportes(error: z.ZodError): {
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

// ---- Horarios deportivos (EPT-12) ----
/**
 * Hora `HH:MM` (lo que envía un `<input type="time">`) o `HH:MM:SS`. Mismo
 * contrato que `esHoraValida` de `src/lib/horarios.ts`.
 */
const horaFranjaSchema = (etiqueta: string) =>
  z
    .string({ message: `Ingresá la hora de ${etiqueta}` })
    .refine(esHoraValida, `Ingresá una hora de ${etiqueta} válida, por ejemplo 14:30`)

/**
 * Franja semanal de un grupo: día 1 (lunes) a 7 (domingo) y un rango con el
 * inicio anterior al fin. La base aplica las mismas condiciones (CHECK y
 * P5585/P5586); esta validación solo evita un viaje inútil.
 */
export const agregarHorarioGrupoSchema = z
  .object({
    dia_semana: z
      .number({ message: 'Seleccioná un día de la semana' })
      .int('Seleccioná un día de la semana')
      .min(1, 'Seleccioná un día de la semana')
      .max(7, 'Seleccioná un día de la semana'),
    hora_inicio: horaFranjaSchema('inicio'),
    hora_fin: horaFranjaSchema('fin'),
  })
  .strict()
  // Zod 4 evalúa este refine aunque un campo ya haya fallado: con una hora
  // inválida no se compara (el error del campo ya la describe).
  .refine(
    (franja) =>
      !esHoraValida(franja.hora_inicio) ||
      !esHoraValida(franja.hora_fin) ||
      normalizarHora(franja.hora_inicio) < normalizarHora(franja.hora_fin),
    {
      message: 'La hora de inicio debe ser anterior a la hora de fin',
      path: ['hora_fin'],
    }
  )

export type AgregarHorarioGrupoData = z.infer<typeof agregarHorarioGrupoSchema>

/** Única acción sobre una franja existente: la baja lógica. */
export const actualizarHorarioGrupoSchema = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('dar_de_baja') }).strict(),
])

export const grupoDeportivoIdSchema = z.string().uuid('Identificador de grupo inválido')
export const franjaHorariaIdSchema = z.string().uuid('Identificador de franja inválido')

/**
 * Alta administrativa: la dirección elige a QUÉ alumno y a QUÉ grupo. Nunca
 * transporta nivel, cupo ni estado: la base los deriva y los valida con las
 * mismas reglas que el alta del propio alumno.
 */
export const inscripcionAdministrativaSchema = z
  .object({
    alumno_id: z.string({ message: 'Seleccioná un alumno' }).uuid('Seleccioná un alumno'),
    grupo_id: z
      .string({ message: 'Seleccioná un grupo deportivo' })
      .uuid('Seleccioná un grupo deportivo'),
  })
  .strict()

export type InscripcionAdministrativaData = z.infer<typeof inscripcionAdministrativaSchema>

// ---- Profesores (EPT-58) ----
/**
 * Especialidad: texto libre y no único. Se normaliza con la misma clase de
 * espacios que PostgreSQL (`src/lib/profesores.ts`) y después se exige el
 * largo del contrato, medido en caracteres como `char_length`.
 */
export const especialidadSchema = z
  .string({ message: 'La especialidad es obligatoria' })
  .transform(normalizarEspecialidad)
  .refine((especialidad) => especialidad.length > 0, 'La especialidad es obligatoria')
  .refine((especialidad) => {
    const largo = cantidadDeCaracteres(especialidad)
    return largo === 0 || (largo >= ESPECIALIDAD_MINIMO && largo <= ESPECIALIDAD_MAXIMO)
  }, `La especialidad debe tener entre ${ESPECIALIDAD_MINIMO} y ${ESPECIALIDAD_MAXIMO} caracteres`)

/**
 * La ficha se guarda completa o no se guarda: legajo y especialidad juntos. El
 * legajo es `perfiles.legajo_nro` y tiene el mismo contrato que el de los
 * alumnos (se rechaza con espacios laterales, nunca se recorta).
 */
export const fichaProfesorSchema = z
  .object({ legajo_nro: legajoAlumnoSchema, especialidad: especialidadSchema })
  .strict()

export type FichaProfesorData = z.infer<typeof fichaProfesorSchema>

/** Motivo opcional: se recortan los extremos, vacío equivale a no informarlo. */
export const motivoEstadoSchema = z
  .string({ message: 'El motivo debe ser un texto' })
  .nullable()
  .optional()
  .transform((motivo) => (motivo == null ? null : normalizarMotivo(motivo)))
  .refine(
    (motivo) => motivo === null || cantidadDeCaracteres(motivo) <= MOTIVO_MAXIMO,
    `El motivo no puede superar los ${MOTIVO_MAXIMO} caracteres`
  )

export const estadoProfesorSchema = z.enum(['ACTIVO', 'INACTIVO'], {
  message: 'Elegí un estado válido: activo o inactivo',
})

const actualizarFichaProfesorSchema = z
  .object({
    accion: z.literal('actualizar_ficha'),
    legajo_nro: legajoAlumnoSchema,
    especialidad: especialidadSchema,
  })
  .strict()

const cambiarEstadoProfesorSchema = z
  .object({
    accion: z.literal('cambiar_estado'),
    estado: estadoProfesorSchema,
    motivo: motivoEstadoSchema,
  })
  .strict()

/** Contrato PATCH discriminado: una sola operación por petición. */
export const actualizarProfesorSchema = z.discriminatedUnion('accion', [
  actualizarFichaProfesorSchema,
  cambiarEstadoProfesorSchema,
])

export type ActualizarProfesorData = z.infer<typeof actualizarProfesorSchema>

export const profesorIdSchema = z.string().uuid('Identificador de profesor inválido')

/** Misma traducción estructural que materias: primer problema, sin detalle de Zod. */
export function primerErrorProfesor(error: z.ZodError): { mensaje: string; campo?: string } {
  return primerErrorMateria(error)
}
