import type { ClienteEPT } from '@/servicios/supabase'

export type RolAplicacion = 'DIRECTOR' | 'DOCENTE' | 'PADRE' | 'ESTUDIANTE' | 'PERSONAL'
export type EstadoAutenticacion =
  | { tipo: 'cargando' }
  | { tipo: 'sin_sesion' }
  | { tipo: 'revalidando'; usuarioId: string }
  | { tipo: 'error_conexion'; usuarioId: string; mensaje: string }
  | { tipo: 'sin_perfil' }
  | { tipo: 'bloqueada' }
  | { tipo: 'rol_no_admitido' }
  | { tipo: 'autenticada'; usuarioId: string; rol: RolAplicacion }

const ROLES = new Set<RolAplicacion>(['DIRECTOR', 'DOCENTE', 'PADRE', 'ESTUDIANTE', 'PERSONAL'])
const MENSAJE_CREDENCIALES = 'No se pudo iniciar sesión. Revisá el correo y la contraseña.'

export interface ObservadorAutenticacion {
  cambiar(estado: EstadoAutenticacion): void
}

/** Controla autenticación y autorización en cada sesión; los claims y metadatos locales no otorgan acceso. */
export class ControladorAutenticacion {
  private revision = 0
  private usuarioActual: string | null = null
  private estadoActual: EstadoAutenticacion = { tipo: 'cargando' }
  private desuscribir: (() => void) | null = null
  private envioEnCurso = false
  private usuarioEventoIngreso: string | null = null

  constructor(
    private readonly cliente: ClienteEPT,
    private readonly observador: ObservadorAutenticacion
  ) {}

  iniciar(): () => void {
    let activo = true
    const suscripcion = this.cliente.auth.onAuthStateChange((evento, sesion) => {
      // Mantener este callback síncrono: el SDK puede esperar su retorno.
      const usuarioId = sesion?.user.id ?? null
      if (evento === 'SIGNED_IN' && this.envioEnCurso && usuarioId) {
        // signInWithPassword notifica SIGNED_IN antes de resolver su promesa. La transacción
        // de ingreso ya revalidará ese usuario y debe conservar la revisión que le pertenece.
        this.usuarioEventoIngreso = usuarioId
        return
      }
      void Promise.resolve().then(() => {
        if (activo) void this.procesarSesion(usuarioId)
      })
    }).data.subscription
    this.desuscribir = () => {
      activo = false
      suscripcion.unsubscribe()
    }
    const revisionInicial = this.revision
    void this.cliente.auth.getSession().then(({ data, error }) => {
      if (!activo || revisionInicial !== this.revision) return
      if (error) {
        this.publicar({ tipo: 'sin_sesion' })
        return
      }
      void this.procesarSesion(data.session?.user.id ?? null, revisionInicial)
    }).catch(() => {
      if (activo && revisionInicial === this.revision) this.publicar({ tipo: 'sin_sesion' })
    })
    return () => this.detener()
  }

  detener(): void {
    this.revision += 1
    this.desuscribir?.()
    this.desuscribir = null
    this.usuarioActual = null
  }

  async ingresar(correo: string, contrasena: string): Promise<void> {
    if (this.envioEnCurso) return
    this.envioEnCurso = true
    this.usuarioEventoIngreso = null
    const revision = ++this.revision
    this.publicar({ tipo: 'cargando' })
    try {
      const { data, error } = await this.cliente.auth.signInWithPassword({ email: correo.trim(), password: contrasena })
      if (revision !== this.revision) return
      if (error || !data.user || !data.session) {
        this.publicar({ tipo: 'sin_sesion' })
        throw new Error(MENSAJE_CREDENCIALES)
      }
      const usuarioEvento = this.usuarioEventoIngreso
      this.usuarioEventoIngreso = null
      if (usuarioEvento && usuarioEvento !== data.user.id) {
        // El evento del cliente y la respuesta del login deben identificar al mismo actor.
        // Si no coinciden, manda el evento vigente y la transacción no puede publicar al usuario anterior.
        const revisionEvento = ++this.revision
        void this.procesarSesion(usuarioEvento, revisionEvento)
        return
      }
      await this.procesarSesion(data.user.id, revision)
      const estado = this.estadoActual
      if (estado.tipo === 'error_conexion') throw new Error(estado.mensaje)
      if (estado.tipo === 'sin_perfil' || estado.tipo === 'bloqueada' || estado.tipo === 'rol_no_admitido') {
        await this.cliente.auth.signOut({ scope: 'local' })
      }
      if (estado.tipo === 'sin_sesion') throw new Error(MENSAJE_CREDENCIALES)
    } catch (causa) {
      if (revision === this.revision) {
        if (this.estadoActual.tipo === 'error_conexion') {
          throw new Error(this.estadoActual.mensaje)
        }
        const mensaje = causa instanceof Error && causa.message !== MENSAJE_CREDENCIALES
          ? 'No se pudo verificar la cuenta. Revisá tu conexión e intentá nuevamente.'
          : MENSAJE_CREDENCIALES
        this.publicar({ tipo: 'sin_sesion' })
        throw new Error(mensaje)
      }
    } finally {
      this.usuarioEventoIngreso = null
      this.envioEnCurso = false
    }
  }

  async salir(): Promise<void> {
    ++this.revision
    this.usuarioActual = null
    this.publicar({ tipo: 'cargando' })
    try {
      const { error } = await this.cliente.auth.signOut({ scope: 'local' })
      if (error) throw error
      this.publicar({ tipo: 'sin_sesion' })
    } catch {
      // No conservar contexto autorizado local ante un cierre ambiguo.
      this.publicar({ tipo: 'sin_sesion' })
    }
  }

  async revalidar(): Promise<void> {
    const revision = ++this.revision
    this.publicar({ tipo: 'cargando' })
    try {
      const { data, error } = await this.cliente.auth.getSession()
      if (revision !== this.revision) return
      if (error) throw error
      await this.procesarSesion(data.session?.user.id ?? null, revision)
    } catch {
      if (revision === this.revision) this.publicar({ tipo: 'sin_sesion' })
    }
  }

  private async procesarSesion(usuarioId: string | null, revisionInicial?: number): Promise<void> {
    const revision = revisionInicial ?? ++this.revision
    if (revision !== this.revision) return
    if (!usuarioId) {
      this.usuarioActual = null
      this.publicar({ tipo: 'sin_sesion' })
      return
    }
    this.usuarioActual = usuarioId
    this.publicar({ tipo: 'revalidando', usuarioId })
    try {
      const { data: usuario, error: errorUsuario } = await this.cliente.auth.getUser()
      if (errorUsuario) throw errorUsuario
      if (revision !== this.revision || this.usuarioActual !== usuarioId) return
      if (!usuario.user || usuario.user.id !== usuarioId) throw new Error('La identidad de sesión cambió.')
      const [{ data: acceso, error: errorAcceso }, { data: rol, error: errorRol }] = await Promise.all([
        this.cliente.rpc('mi_estado_acceso'),
        this.cliente.rpc('rol_actual'),
      ])
      if (errorAcceso || errorRol) throw errorAcceso ?? errorRol
      if (revision !== this.revision || this.usuarioActual !== usuarioId) return
      if (acceso === 'SIN_PERFIL') return this.publicar({ tipo: 'sin_perfil' })
      if (acceso !== 'HABILITADO') return this.publicar({ tipo: 'bloqueada' })
      if (!ROLES.has(rol as RolAplicacion)) return this.publicar({ tipo: 'rol_no_admitido' })
      this.publicar({ tipo: 'autenticada', usuarioId, rol: rol as RolAplicacion })
    } catch {
      if (revision === this.revision && this.usuarioActual === usuarioId) {
        this.publicar({ tipo: 'error_conexion', usuarioId, mensaje: 'No se pudo verificar tu acceso. Comprobá la conexión e intentá nuevamente.' })
      }
    }
  }

  private publicar(estado: EstadoAutenticacion): void {
    this.estadoActual = estado
    this.observador.cambiar(estado)
  }
}
