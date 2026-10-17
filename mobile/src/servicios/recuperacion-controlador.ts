// Controlador del retorno del correo de recuperación (EPT-106).
//
// Recibe el enlace ya interpretado, verifica con Auth (`exchangeCodeForSession`) y recién entonces permite
// fijar la contraseña de la cuenta verificada. Cada operación asíncrona lleva el número de revisión con el que
// nació: si el usuario cancela, cambia de enlace o sale de la pantalla, las respuestas atrasadas se descartan y
// no escriben estado ni tocan la sesión.
import {
  actualizarContrasena,
  huellaDeEnlace,
  intercambiarCodigo,
  mensajeDeActualizacion,
  type EnlaceRecuperacion,
  type ResultadoIntercambio,
} from '@/servicios/recuperacion'
import { iniciarRecuperacion, marcarSesionAlterada } from '@/servicios/recuperacion-activa'
import type { ClienteEPT } from '@/servicios/supabase'

export type CausaEnlaceNoValido =
  | 'expirado'
  | 'invalido'
  | 'no_admitido'
  | 'usado'
  | 'sin_verificador'
  | 'sin_conexion'
  | 'no_es_recuperacion'
  | 'sesion_vencida'
  | 'error'

export type EstadoRecuperacion =
  | { tipo: 'iniciando' }
  /** Hay una sesión de otra cuenta: se pide confirmación antes de reemplazarla. */
  | { tipo: 'confirmar_reemplazo' }
  | { tipo: 'verificando' }
  | { tipo: 'formulario'; usuarioId: string; error?: string }
  | { tipo: 'guardando'; usuarioId: string }
  | { tipo: 'enlace_no_valido'; causa: CausaEnlaceNoValido }
  | { tipo: 'exito' }

export type ObservadorRecuperacion = (estado: EstadoRecuperacion) => void

type ClienteRecuperacion = Pick<ClienteEPT, 'auth'>
type EnlaceConCodigo = Extract<EnlaceRecuperacion, { tipo: 'codigo' }>

const MAXIMO_INTERCAMBIOS = 20
/**
 * Un código de recuperación se canjea una sola vez por proceso: una entrega repetida del mismo enlace (o el
 * remonte de la pantalla) reutiliza el resultado en lugar de presentarlo de nuevo, porque Auth lo rechazaría y
 * el SDK ya descartó el verificador de la entrega buena. Solo memoria: nada se persiste.
 */
const intercambios = new Map<string, Promise<ResultadoIntercambio>>()

function intercambioUnico(huella: string, crear: () => Promise<ResultadoIntercambio>): Promise<ResultadoIntercambio> {
  const existente = intercambios.get(huella)
  if (existente) return existente
  const nuevo = crear()
  intercambios.set(huella, nuevo)
  while (intercambios.size > MAXIMO_INTERCAMBIOS) {
    const masViejo = intercambios.keys().next().value
    if (masViejo === undefined) break
    intercambios.delete(masViejo)
  }
  return nuevo
}

/** Solo para pruebas. */
export function reiniciarIntercambiosParaPruebas(): void {
  intercambios.clear()
}

export class ControladorRecuperacion {
  private revision = 0
  private liberarCompuerta: (() => void) | null = null
  private huellaEnCurso: string | null = null
  private pendiente: EnlaceConCodigo | null = null
  private usuarioRecuperado: string | null = null
  private estado: EstadoRecuperacion = { tipo: 'iniciando' }

  constructor(
    private readonly cliente: ClienteRecuperacion,
    private readonly observador: ObservadorRecuperacion
  ) {}

  /** Abre la compuerta de recuperación: desde aquí el acceso ordinario no procesa los eventos de Auth. */
  iniciar(): void {
    if (!this.liberarCompuerta) this.liberarCompuerta = iniciarRecuperacion()
  }

  /** Cierra la compuerta y descarta cualquier respuesta atrasada. Es idempotente. */
  detener(): void {
    this.revision += 1
    this.pendiente = null
    this.usuarioRecuperado = null
    this.huellaEnCurso = null
    const liberar = this.liberarCompuerta
    this.liberarCompuerta = null
    liberar?.()
  }

  /** Recibe un enlace (arranque en frío, aplicación abierta o entrega repetida). */
  async procesarEnlace(enlace: EnlaceRecuperacion): Promise<void> {
    this.iniciar()
    if (enlace.tipo !== 'codigo') {
      ++this.revision
      this.huellaEnCurso = null
      this.pendiente = null
      return this.publicar({ tipo: 'enlace_no_valido', causa: enlace.tipo === 'no_admitido' ? 'no_admitido' : enlace.motivo })
    }
    const huella = huellaDeEnlace(enlace)
    // La misma entrega llegando dos veces mientras se procesa (o ya procesada aquí) no se repite.
    if (this.huellaEnCurso === huella) return
    const revision = ++this.revision
    this.huellaEnCurso = huella
    this.pendiente = enlace
    this.publicar({ tipo: 'iniciando' })

    const presentado = intercambios.get(huella)
    if (presentado) {
      const resultado = await presentado
      if (revision !== this.revision) return
      return this.aplicarResultado(resultado, true)
    }

    const sesionPrevia = await this.usuarioDeLaSesion()
    if (revision !== this.revision) return
    // Nunca se reemplaza una sesión sin que la persona lo confirme.
    if (sesionPrevia) return this.publicar({ tipo: 'confirmar_reemplazo' })
    await this.canjear(enlace, huella, revision)
  }

  /** La persona aceptó cerrar la sesión de la otra cuenta para continuar con la recuperación. */
  async confirmarReemplazo(): Promise<void> {
    const enlace = this.pendiente
    if (!enlace || this.estado.tipo !== 'confirmar_reemplazo') return
    const revision = ++this.revision
    await this.canjear(enlace, huellaDeEnlace(enlace), revision)
  }

  /** Cancela sin efectos: la sesión de la otra cuenta, si existe, sigue intacta. */
  cancelar(): void {
    this.detener()
  }

  async guardar(contrasena: string, confirmacion: string): Promise<void> {
    const actual = this.estado
    if (actual.tipo !== 'formulario' || !this.usuarioRecuperado) return // doble toque o estado ajeno
    if (contrasena.length === 0) {
      return this.publicar({ tipo: 'formulario', usuarioId: actual.usuarioId, error: 'Ingresá la nueva contraseña.' })
    }
    if (contrasena !== confirmacion) {
      return this.publicar({ tipo: 'formulario', usuarioId: actual.usuarioId, error: 'Las contraseñas no coinciden.' })
    }
    const usuarioId = this.usuarioRecuperado
    const revision = ++this.revision
    this.publicar({ tipo: 'guardando', usuarioId })
    const resultado = await actualizarContrasena(this.cliente.auth, contrasena, { usuarioEsperado: usuarioId })
    if (revision !== this.revision) return
    if (resultado.tipo === 'ok') {
      await this.cerrarSesionDeRecuperacion()
      if (revision !== this.revision) return
      this.usuarioRecuperado = null
      return this.publicar({ tipo: 'exito' })
    }
    if (resultado.tipo === 'sesion_expirada' || resultado.tipo === 'usuario_distinto') {
      this.usuarioRecuperado = null
      return this.publicar({ tipo: 'enlace_no_valido', causa: 'sesion_vencida' })
    }
    return this.publicar({ tipo: 'formulario', usuarioId, error: mensajeDeActualizacion(resultado) })
  }

  private async canjear(enlace: EnlaceConCodigo, huella: string, revision: number): Promise<void> {
    this.publicar({ tipo: 'verificando' })
    const resultado = await intercambioUnico(huella, () => intercambiarCodigo(this.cliente.auth, enlace))
    if (revision !== this.revision) return
    this.pendiente = null
    await this.aplicarResultado(resultado, false)
  }

  private async aplicarResultado(resultado: ResultadoIntercambio, repeticion: boolean): Promise<void> {
    if (resultado.tipo === 'ok') {
      // Una entrega repetida solo continúa si la sesión guardada sigue siendo la verificada.
      if (repeticion && (await this.usuarioDeLaSesion()) !== resultado.usuarioId) {
        return this.publicar({ tipo: 'enlace_no_valido', causa: 'usado' })
      }
      marcarSesionAlterada()
      this.usuarioRecuperado = resultado.usuarioId
      return this.publicar({ tipo: 'formulario', usuarioId: resultado.usuarioId })
    }
    if (resultado.tipo === 'no_es_recuperacion') marcarSesionAlterada()
    const causa: CausaEnlaceNoValido =
      resultado.tipo === 'enlace_invalido' ? 'usado'
        : resultado.tipo === 'no_es_recuperacion' ? 'no_es_recuperacion'
          : resultado.tipo === 'sin_verificador' ? 'sin_verificador'
            : resultado.tipo === 'sin_conexion' ? 'sin_conexion'
              : 'error'
    this.publicar({ tipo: 'enlace_no_valido', causa })
  }

  private async usuarioDeLaSesion(): Promise<string | null> {
    try {
      const { data, error } = await this.cliente.auth.getSession()
      if (error) return null
      return data.session?.user.id ?? null
    } catch {
      return null
    }
  }

  /** La sesión creada por el enlace no debe quedar como ingreso: la persona entra con la contraseña nueva. */
  private async cerrarSesionDeRecuperacion(): Promise<void> {
    marcarSesionAlterada()
    try {
      await this.cliente.auth.signOut({ scope: 'local' })
    } catch {
      // El cierre local es una precaución: su fallo no deshace el cambio ya confirmado por Auth.
    }
  }

  private publicar(estado: EstadoRecuperacion): void {
    this.estado = estado
    this.observador(estado)
  }
}
