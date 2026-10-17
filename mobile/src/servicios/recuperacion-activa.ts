// Compuerta de la recuperación de contraseña (EPT-106).
//
// Mientras el usuario completa un enlace de recuperación, la sesión guardada puede ser la de la cuenta que
// pidió el enlace y no la que usaba la aplicación. El controlador de acceso consulta esta compuerta y no
// trata los eventos de Auth de ese tramo como un ingreso ordinario: no consulta roles ni publica datos de
// una cuenta mientras la otra está en medio de su recuperación.
//
// Es estado de proceso (memoria): nada se persiste y nada contiene el código del enlace.

export interface LiberacionRecuperacion {
  /** El intercambio del enlace reemplazó la sesión guardada: quien escucha debe volver a validar el acceso. */
  readonly sesionAlterada: boolean
}

type Escucha = (liberacion: LiberacionRecuperacion) => void

let activas = 0
let sesionAlterada = false
const escuchas = new Set<Escucha>()

export function recuperacionActiva(): boolean {
  return activas > 0
}

/** Abre la compuerta. Devuelve la función que la cierra; es idempotente por llamada. */
export function iniciarRecuperacion(): () => void {
  activas += 1
  let liberada = false
  return () => {
    if (liberada) return
    liberada = true
    activas = Math.max(0, activas - 1)
    if (activas > 0) return
    const liberacion: LiberacionRecuperacion = { sesionAlterada }
    sesionAlterada = false
    for (const escucha of [...escuchas]) escucha(liberacion)
  }
}

/** Marca que la sesión guardada cambió (o pudo cambiar) durante esta recuperación. */
export function marcarSesionAlterada(): void {
  if (activas > 0) sesionAlterada = true
}

export function alLiberarRecuperacion(escucha: Escucha): () => void {
  escuchas.add(escucha)
  return () => {
    escuchas.delete(escucha)
  }
}

/** Solo para pruebas. */
export function reiniciarRecuperacionParaPruebas(): void {
  activas = 0
  sesionAlterada = false
  escuchas.clear()
}
