/**
 * Tipos compartidos de la credencial QR (EPT-64). Sin código: los importan tanto
 * el servidor como los componentes del navegador, y no arrastran dependencias.
 */

export type EstadoAlumnoQr = 'ACTIVO' | 'INACTIVO'

export type AlumnoTarjeta = {
  id: string
  nombre: string
  apellido: string
  /** El legajo es el único identificador escolar que la tarjeta muestra: nunca el DNI. */
  legajo_nro: string | null
  estado: EstadoAlumnoQr
}

/** Estado que la interfaz presenta para un alumno. */
export type EstadoTarjeta =
  | 'SIN_CREDENCIAL'
  | 'VIGENTE'
  | 'REVOCADA'
  | 'ALUMNO_INACTIVO'
  | 'ACCESO_BLOQUEADO'

export type CredencialResumen = {
  id: string
  emitida_en: string
  revocada_en: string | null
}

export type TarjetaCredencial = {
  alumno: AlumnoTarjeta
  estado: EstadoTarjeta
  /** La credencial vigente o, si no hay, la última revocada. */
  credencial: CredencialResumen | null
  /** URI de datos del QR. Solo existe con la credencial VIGENTE. */
  qr: string | null
}

/** Fila del panel de Dirección: el alumno y el estado de su credencial. */
export type FilaPanel = {
  id: string
  nombre: string
  apellido: string
  legajo_nro: string | null
  estado: EstadoAlumnoQr
  curso: string | null
  credencial: 'VIGENTE' | 'REVOCADA' | 'SIN_CREDENCIAL'
  emitida_en: string | null
}

/** Una fila del historial interno (solo Dirección). */
export type EntradaHistorial = {
  id: string
  estado: 'ACTIVA' | 'REVOCADA'
  emitida_en: string
  emitida_por_nombre: string
  revocada_en: string | null
  revocada_por_nombre: string | null
  motivo_revocacion: string | null
  reemplaza_a: string | null
}
