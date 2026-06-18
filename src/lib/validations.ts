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
