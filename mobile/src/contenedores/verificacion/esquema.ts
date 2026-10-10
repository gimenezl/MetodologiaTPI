import { z } from 'zod'

export const TAMANO_MINIMO_KB = 1
export const TAMANO_MAXIMO_KB = 32
const MENSAJE = `Ingresá un tamaño entre ${TAMANO_MINIMO_KB} y ${TAMANO_MAXIMO_KB} KB.`

export const esquemaVerificacion = z.object({
  tamanoKb: z
    .string()
    .trim()
    .regex(/^\d{1,3}$/u, MENSAJE)
    .refine(valor => Number(valor) >= TAMANO_MINIMO_KB && Number(valor) <= TAMANO_MAXIMO_KB, MENSAJE),
})

export type DatosVerificacion = z.infer<typeof esquemaVerificacion>
