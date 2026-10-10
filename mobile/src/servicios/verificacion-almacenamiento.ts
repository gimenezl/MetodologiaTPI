import type { AlmacenamientoSeguro } from '@/servicios/almacenamiento-seguro'

export interface ResultadoVerificacion {
  ok: boolean
  bytes: number
}

/** Carga con forma de sesión: JSON con un token largo y texto no ASCII, de `tamanoKb` KiB aproximados. */
export function generarCargaDePrueba(tamanoKb: number): string {
  const objetivo = tamanoKb * 1024
  const relleno = 'abcdefghijklmnopqrstuvwxyzÁÉÍÓÚñ0123456789-_'
  let token = ''
  while (token.length < objetivo) token += relleno
  return JSON.stringify({ access_token: token.slice(0, objetivo), usuario: 'Prueba de almacenamiento' })
}

/** Guarda, lee y borra una carga de tamaño real. Comprueba el almacenamiento en el propio dispositivo. */
export async function verificarAlmacenamiento(
  almacenamiento: AlmacenamientoSeguro,
  tamanoKb: number
): Promise<ResultadoVerificacion> {
  const clave = 'ept-verificacion-infraestructura'
  const carga = generarCargaDePrueba(tamanoKb)
  try {
    await almacenamiento.setItem(clave, carga)
    const leido = await almacenamiento.getItem(clave)
    return { ok: leido === carga, bytes: carga.length }
  } finally {
    await almacenamiento.removeItem(clave).catch(() => undefined)
  }
}
