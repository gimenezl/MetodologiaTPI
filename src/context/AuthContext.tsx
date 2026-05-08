'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { createClient } from '@/services/supabase'
import { Perfil } from '@/types/database.types'

type RolNombre = 'DIRECTOR' | 'DOCENTE' | 'PADRE' | 'ESTUDIANTE' | 'PERSONAL' | null

interface AuthContextType {
  user: User | null
  session: Session | null
  perfil: (Perfil & { rol: { nombre: string } | null }) | null
  rol: RolNombre
  isLoading: boolean
  isDirector: boolean
  isDocente: boolean
  isPadre: boolean
  isEstudiante: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<AuthContextType['perfil']>(null)
  const [isLoading, setIsLoading] = useState(true)
  const supabase = createClient()

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
          setIsLoading(false)
        }
      }
    )
    return () => {
      cancelled = true
      clearTimeout(timeoutId)
      subscription.unsubscribe()
    }
  }, [])

  async function fetchPerfil(userId: string) {
    try {
      const { data } = await supabase
        .from('perfiles')
        .select('*, rol:roles(nombre)')
        .eq('user_id', userId)
        .single()
      setPerfil(data as AuthContextType['perfil'])
    } catch {
      setPerfil(null)
    } finally {
      setIsLoading(false)
    }
  }

  const rol = (perfil?.rol?.nombre as RolNombre) ?? null

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setSession(null)
    setPerfil(null)
  }

  return (
    <AuthContext.Provider value={{
      user, session, perfil, rol, isLoading,
      isDirector: rol === 'DIRECTOR',
      isDocente: rol === 'DOCENTE' || rol === 'DIRECTOR',
      isPadre: rol === 'PADRE',
      isEstudiante: rol === 'ESTUDIANTE',
      signOut,
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
