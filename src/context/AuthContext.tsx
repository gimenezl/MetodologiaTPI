'use client'

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { User, Session } from '@supabase/supabase-js'
import { createClient } from '@/services/supabase'
import { Perfil } from '@/types/database.types'

type RolNombre = 'DIRECTOR' | 'DOCENTE' | 'PADRE' | 'ESTUDIANTE' | 'PERSONAL' | null

/**
 * Estado de acceso de la sesión, tal como lo informa `public.mi_estado_acceso()`
 * (EPT-59). `null` mientras no se conoce o cuando no se pudo resolver.
 */
export type EstadoAccesoSesion = 'SIN_SESION' | 'SIN_PERFIL' | 'HABILITADO' | 'BLOQUEADO'

const ESTADOS_DE_ACCESO = new Set<EstadoAccesoSesion>([
  'SIN_SESION',
  'SIN_PERFIL',
  'HABILITADO',
  'BLOQUEADO',
])

/** Ruta a la que se lleva a una sesión cuyo perfil está bloqueado. */
export const RUTA_ACCESO_BLOQUEADO = '/acceso-bloqueado'

interface AuthContextType {
  user: User | null
  session: Session | null
  perfil: (Perfil & { rol: { nombre: string } | null }) | null
  rol: RolNombre
  /**
   * Estado de acceso resuelto en la base. Se consulta cuando el perfil propio
   * no se puede leer (sin perfil o bloqueado) y en cada navegación del panel.
   */
  estadoAcceso: EstadoAccesoSesion | null
  isLoading: boolean
  isDirector: boolean
  isDocente: boolean
  isPadre: boolean
  isEstudiante: boolean
  signOut: () => Promise<void>
  /** Vuelve a consultar el estado de acceso; si es BLOQUEADO, lleva a la pantalla de bloqueo. */
  revalidarAcceso: () => Promise<EstadoAccesoSesion | null>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<AuthContextType['perfil']>(null)
  const [estadoAcceso, setEstadoAcceso] = useState<EstadoAccesoSesion | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [supabase] = useState(() => createClient())
  const router = useRouter()
  const pathname = usePathname()

  /**
   * Consulta el estado de acceso propio. Es la única lectura que la base le
   * permite a un perfil BLOQUEADO sobre sí mismo; nunca devuelve datos.
   */
  const consultarEstadoAcceso = useCallback(async (): Promise<EstadoAccesoSesion | null> => {
    try {
      const { data, error } = await supabase.rpc('mi_estado_acceso')
      if (error) return null
      return typeof data === 'string' && ESTADOS_DE_ACCESO.has(data as EstadoAccesoSesion)
        ? (data as EstadoAccesoSesion)
        : null
    } catch {
      return null
    }
  }, [supabase])

  const fetchPerfil = useCallback(async (userId: string) => {
    try {
      const { data } = await supabase
        .from('perfiles')
        .select('*, rol:roles(nombre)')
        .eq('user_id', userId)
        .maybeSingle()
      setPerfil((data as AuthContextType['perfil']) ?? null)
      // Un perfil que no se puede leer es una cuenta sin perfil o un perfil
      // bloqueado: las políticas de la base no dejan distinguirlos por la
      // lectura, así que se pregunta el estado explícitamente.
      setEstadoAcceso(data ? 'HABILITADO' : await consultarEstadoAcceso())
    } catch {
      setPerfil(null)
      setEstadoAcceso(await consultarEstadoAcceso())
    } finally {
      setIsLoading(false)
    }
  }, [supabase, consultarEstadoAcceso])

  useEffect(() => {
    let cancelled = false
    const timeoutId = setTimeout(() => {
      if (!cancelled) setIsLoading(false)
    }, 4000)

    supabase.auth.getUser()
      .then(({ data: { user } }) => {
        if (cancelled) return
        setUser(user ?? null)
        if (user) {
          supabase.auth.getSession().then(({ data: { session } }) => {
            if (!cancelled) setSession(session)
          })
          fetchPerfil(user.id)
        } else {
          setIsLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setIsLoading(false)
      })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session)
        setUser(session?.user ?? null)
        if (session?.user) fetchPerfil(session.user.id)
        else {
          setPerfil(null)
          setEstadoAcceso(null)
          setIsLoading(false)
        }
      }
    )
    return () => {
      cancelled = true
      clearTimeout(timeoutId)
      subscription.unsubscribe()
    }
  }, [supabase, fetchPerfil])

  // Un perfil bloqueado no permanece en el panel: la navegación del cliente no
  // vuelve a ejecutar el layout del servidor, así que esta es la guarda que
  // actúa entre páginas. Los datos ya los niega la base.
  useEffect(() => {
    if (estadoAcceso === 'BLOQUEADO' && pathname?.startsWith('/dashboard')) {
      router.replace(RUTA_ACCESO_BLOQUEADO)
    }
  }, [estadoAcceso, pathname, router])

  const revalidarAcceso = useCallback(async () => {
    const estado = await consultarEstadoAcceso()
    if (estado === 'BLOQUEADO') {
      setPerfil(null)
      setEstadoAcceso('BLOQUEADO')
    } else if (estado !== null) {
      setEstadoAcceso((previo) => (previo === 'BLOQUEADO' || previo === null ? estado : previo))
    }
    return estado
  }, [consultarEstadoAcceso])

  const rol = (perfil?.rol?.nombre as RolNombre) ?? null

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setSession(null)
    setPerfil(null)
    setEstadoAcceso(null)
  }

  return (
    <AuthContext.Provider value={{
      user, session, perfil, rol, estadoAcceso, isLoading,
      isDirector: rol === 'DIRECTOR',
      isDocente: rol === 'DOCENTE' || rol === 'DIRECTOR',
      isPadre: rol === 'PADRE',
      isEstudiante: rol === 'ESTUDIANTE',
      signOut,
      revalidarAcceso,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
