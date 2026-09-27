import { Lock } from '@phosphor-icons/react/dist/ssr'
import { EnlaceBoton } from '@/components/ui/EnlaceBoton'

/**
 * Pantalla «Acceso restringido» de las páginas protegidas en el servidor.
 *
 * Es la misma composición que usan Alumnos, Profesores y el armazón del panel:
 * un título, el mensaje de la guarda y un único enlace para volver.
 */
export function AccesoRestringido({ mensaje }: { mensaje: string }) {
  return (
    <div className="max-w-md mx-auto mt-12 text-center">
      <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
        <Lock size={32} weight="fill" className="text-red-500" />
      </div>
      <h1 className="text-xl font-extrabold text-neutral-900 tracking-tight">Acceso restringido</h1>
      <p className="text-neutral-500 text-sm mt-2">{mensaje}</p>
      <EnlaceBoton href="/dashboard" className="mt-6">
        Volver al panel
      </EnlaceBoton>
    </div>
  )
}
