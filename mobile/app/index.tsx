import { useRouter } from 'expo-router'
import type { ReactElement } from 'react'

import { AccesoContenedor } from '@/contenedores/acceso/AccesoContenedor'

export default function Inicio(): ReactElement {
  const router = useRouter()
  return <AccesoContenedor alRecuperarContrasena={() => router.push('/recuperar')} />
}
