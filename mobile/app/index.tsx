import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import type { ReactElement } from 'react'

import { AccesoContenedor } from '@/contenedores/acceso/AccesoContenedor'

export default function Inicio(): ReactElement {
  const router = useRouter()
  return <AccesoContenedor alVerificarRecibo={Constants.expoConfig?.extra?.eptRecibosNativeQa===true ? ()=>router.push('/recibo-prueba') : undefined} alRecuperarContrasena={() => router.push('/recuperar')} />
}
