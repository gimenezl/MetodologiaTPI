import { Redirect } from 'expo-router'
import type { ReactElement } from 'react'

/**
 * Cualquier enlace profundo hacia una ruta que la aplicación no conoce termina en el inicio, sin mostrar
 * parámetros ni detalles del enlace recibido.
 */
export default function NoEncontrada(): ReactElement {
  return <Redirect href="/" />
}
