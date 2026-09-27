'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SignOut } from '@phosphor-icons/react'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/services/supabase'

/**
 * Único control de la pantalla de acceso bloqueado (EPT-59).
 *
 * Cierra la sesión de este dispositivo (`scope: 'local'`): es lo que necesita
 * quien quedó con la sesión abierta en una computadora de la escuela. Las demás
 * sesiones de la cuenta no ven datos —la base niega todo a un perfil
 * BLOQUEADO— y el baneo en Auth que aplica Dirección ya impide renovarlas.
 */
export function CerrarSesionBloqueada() {
  const router = useRouter()
  const [cerrando, setCerrando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function cerrarSesion() {
    if (cerrando) return
    setCerrando(true)
    setError(null)
    try {
      const { error: errorSalida } = await createClient().auth.signOut({ scope: 'local' })
      if (errorSalida) throw errorSalida
      router.replace('/login')
      router.refresh()
    } catch {
      setError('No pudimos cerrar la sesión. Volvé a intentarlo.')
      setCerrando(false)
    }
  }

  return (
    <div className="mt-6 flex flex-col items-center gap-3">
      <Button type="button" onClick={cerrarSesion} loading={cerrando} aria-busy={cerrando}>
        <SignOut size={16} aria-hidden="true" />
        Cerrar sesión
      </Button>
      <p role="status" aria-live="polite" className="text-sm text-red-700 min-h-5">
        {error}
      </p>
    </div>
  )
}
