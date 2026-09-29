import { nombrePersona } from './formato'

/**
 * Modelo de presentación común a las tres pantallas administrativas de
 * inscripciones (comedor, transporte y deportes). Cada pantalla traduce su
 * lectura del servidor a estas filas; la lista compartida no conoce el dominio.
 */

export type EstadoInscripcion = 'ACTIVA' | 'CANCELADA'

/**
 * Estado de confirmación de una inscripción o de una matrícula.
 *
 * Es un dato APARTE del estado vigente: una inscripción activa sin confirmar
 * sigue siendo válida. Confirmar es una acción administrativa posterior al alta,
 * registrada con quién y cuándo, y solo la ve Dirección.
 */
export type Confirmacion = {
  confirmada: boolean
  confirmadaEn: string | null
  /** Nombre completo de quien confirmó; `null` si no se confirmó o no se conoce. */
  confirmadaPor: string | null
}

export type ColumnaDetalle = { clave: string; titulo: string }

export type FilaInscripcion = {
  id: string
  alumno: string
  legajo: string | null
  /** Valores de las columnas propias del dominio, indexados por `ColumnaDetalle.clave`. */
  detalles: Record<string, { principal: string; secundario?: string }>
  /** Cómo se nombra el servicio o el grupo en los mensajes y en el diálogo. */
  descripcion: string
  estado: EstadoInscripcion
  fechaAlta: string
  fechaBaja: string | null
  confirmacion: Confirmacion
  /** Texto en minúsculas sobre el que busca el filtro. */
  busqueda: string
}

/** Proyecta los cuatro campos de confirmación que devuelven las lecturas. */
export function confirmacionDe(fila: {
  confirmada: boolean
  confirmada_en: string | null
  confirmada_por_nombre: string | null
  confirmada_por_apellido: string | null
}): Confirmacion {
  return {
    confirmada: fila.confirmada,
    confirmadaEn: fila.confirmada_en,
    confirmadaPor: fila.confirmada
      ? nombrePersona(fila.confirmada_por_nombre, fila.confirmada_por_apellido)
      : null,
  }
}

export function textoDeBusqueda(...partes: (string | null | undefined)[]) {
  return partes.filter(Boolean).join(' ').toLocaleLowerCase('es-AR')
}
