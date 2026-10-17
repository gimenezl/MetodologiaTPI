// Último enlace profundo recibido por la aplicación (arranque en frío o aplicación abierta).
//
// `useLinkingURL` lee el valor que el módulo nativo conserva, de modo que una pantalla montada después de recibir
// el enlace (como la ruta de retorno del correo) igualmente lo obtiene. Esta capa fina concentra la dependencia de
// `expo-linking` para poder sustituirla en las pruebas.
import * as Linking from 'expo-linking'

/** URL del último enlace profundo, o `null` si la aplicación no se abrió con uno. */
export function useEnlaceEntrante(): string | null {
  return Linking.useLinkingURL()
}

/** Olvida el enlace entregado: una vez usado no debe volver a presentarse si la pantalla se monta otra vez. */
export function olvidarEnlaceEntrante(): void {
  Linking.clearInitialURL?.()
}
