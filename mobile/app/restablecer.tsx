import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, type ReactElement } from 'react'

import { entornoDelBundle } from '@/configuracion/entorno'
import { EstadoSinConfigurar } from '@/contenedores/recuperacion/EstadoSinConfigurar'
import { RestablecerContenedor } from '@/contenedores/recuperacion/RestablecerContenedor'
import { olvidarEnlaceEntrante, useEnlaceEntrante } from '@/servicios/enlace-entrante'
import { urlDesdeParametros } from '@/servicios/recuperacion'
import { obtenerClienteSupabase } from '@/servicios/supabase'

/**
 * Retorno del correo de recuperación (`educarparatransformar://restablecer`). La ruta solo lee el enlace; la
 * verificación la hace Auth y el cambio de contraseña lo gobierna `ControladorRecuperacion`.
 */
export default function Restablecer(): ReactElement {
  const router = useRouter()
  const entrante = useEnlaceEntrante()
  const parametros = useLocalSearchParams<Record<string, string | string[]>>()
  // Los parámetros son los de la navegación que montó esta pantalla (los más recientes); la URL cruda del sistema
  // —que puede conservar un enlace anterior— solo se usa si el enrutador no separó ninguno.
  const url = urlDesdeParametros(parametros) ?? entrante
  const cliente = useMemo(() => (entornoDelBundle().ok ? obtenerClienteSupabase() : null), [])
  if (!cliente) return <EstadoSinConfigurar />
  const irAlInicio = () => {
    // El enlace ya se usó: no debe volver a entregarse si esta pantalla se monta otra vez.
    olvidarEnlaceEntrante()
    router.replace('/')
  }
  return (
    <RestablecerContenedor
      cliente={cliente}
      url={url}
      onTerminar={irAlInicio}
      onSolicitarNuevo={() => router.replace('/recuperar')}
    />
  )
}
