/**
 * Comprobación de origen de una petición que cambia estado (EPT-65).
 *
 * Las rutas del proyecto se autentican con la cookie de sesión de Supabase, que
 * viaja sola con cualquier petición del navegador. El repositorio no tenía una
 * comprobación de origen para esas rutas: se apoyaba en `SameSite=Lax`, que ya
 * impide enviar la cookie en una petición POST entre sitios. Esta función agrega
 * la segunda barrera (defensa en profundidad) a las dos rutas nuevas, sin tocar
 * las demás:
 *
 *   - Si hay `Origin`, su host tiene que ser el de esta aplicación.
 *   - Si no hay `Origin` pero sí `Sec-Fetch-Site`, tiene que ser del mismo origen
 *     (o `none`, una navegación del propio usuario).
 *   - Sin ninguno de los dos (un cliente que no es un navegador: no tiene una
 *     cookie ajena que abusar), se admite.
 *
 * Es una función pura sobre `Headers` para probarla sin servidor.
 */
export function origenPermitido(encabezados: Headers): boolean {
  const origen = encabezados.get('origin')
  if (origen !== null) {
    let anfitrionDelOrigen: string
    try {
      anfitrionDelOrigen = new URL(origen).host
    } catch {
      // `Origin: null` (documento aislado) y cualquier valor ilegible.
      return false
    }
    const propio = (encabezados.get('x-forwarded-host') ?? encabezados.get('host') ?? '')
      .split(',')[0]
      .trim()
      .toLowerCase()
    return propio !== '' && anfitrionDelOrigen.toLowerCase() === propio
  }

  const sitio = encabezados.get('sec-fetch-site')
  if (sitio !== null) return sitio === 'same-origin' || sitio === 'none'

  return true
}
