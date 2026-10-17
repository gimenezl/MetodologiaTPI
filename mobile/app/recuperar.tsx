import { useRouter } from 'expo-router'
import { useMemo, type ReactElement } from 'react'

import { entornoDelBundle } from '@/configuracion/entorno'
import { EstadoSinConfigurar } from '@/contenedores/recuperacion/EstadoSinConfigurar'
import { SolicitudRecuperacionContenedor } from '@/contenedores/recuperacion/SolicitudRecuperacionContenedor'
import { obtenerClienteSupabase } from '@/servicios/supabase'

/** Solicitud del correo de recuperación, accesible desde el inicio de sesión. */
export default function Recuperar(): ReactElement {
  const router = useRouter()
  const cliente = useMemo(() => (entornoDelBundle().ok ? obtenerClienteSupabase() : null), [])
  if (!cliente) return <EstadoSinConfigurar />
  return (
    <SolicitudRecuperacionContenedor
      cliente={cliente}
      onVolver={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  )
}
