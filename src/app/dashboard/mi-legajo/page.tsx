import type { Metadata } from 'next'
import Link from 'next/link'
import { Lock, Student, WarningCircle } from '@phosphor-icons/react/dist/ssr'
import { Button } from '@/components/ui/Button'
import { requerirSesion } from '@/services/autorizacion'
import { listarAlumnos, listarHistorialAlumno } from '@/services/alumnos.service'
import { SituacionAcademica } from '../alumnos/_components/SituacionAcademica'

export const metadata: Metadata = {
  title: 'Mi legajo académico | Panel',
}

export const dynamic = 'force-dynamic'

/**
 * Vista propia del estudiante (EPT-22).
 *
 * No recibe ni filtra por identificador: pide el listado y RLS devuelve
 * exclusivamente el legajo cuyo `perfil_id` coincide con la sesión. Por eso un
 * estudiante no puede consultar el legajo de otro ni inferir que exista, ni
 * siquiera manipulando la petición: no hay parámetro que manipular.
 */
export default async function MiLegajoPage() {
  const sesion = await requerirSesion()

  if (!sesion.autorizado) {
    return (
      <div className="max-w-md mx-auto mt-12 text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
          <Lock size={32} weight="fill" className="text-red-500" />
        </div>
        <h1 className="text-xl font-extrabold text-neutral-900 tracking-tight">
          Acceso restringido
        </h1>
        <p className="text-neutral-500 text-sm mt-2">{sesion.mensaje}</p>
        <Link href="/login" className="inline-block mt-6">
          <Button>Iniciar sesión</Button>
        </Link>
      </div>
    )
  }

  const propios = await listarAlumnos()

  if (!propios.ok) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <Encabezado />
        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-2xl p-6 flex gap-3 items-start"
        >
          <WarningCircle
            size={22}
            weight="fill"
            className="text-red-500 shrink-0 mt-0.5"
          />
          <div>
            <p className="text-sm font-semibold text-red-800">
              No pudimos cargar tu legajo académico
            </p>
            <p className="text-sm text-red-700 mt-1">{propios.mensaje}</p>
          </div>
        </div>
      </div>
    )
  }

  const alumno = propios.datos[0]

  if (!alumno) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <Encabezado />
        <div className="bg-white rounded-2xl border border-neutral-200 py-16 px-5 text-center">
          <Student size={40} className="text-neutral-300 mx-auto mb-3" />
          <p className="font-semibold text-neutral-700">
            Todavía no tenés un legajo académico
          </p>
          <p className="text-neutral-400 text-sm mt-1">
            Cuando la dirección complete tu situación académica, vas a poder consultarla
            desde acá.
          </p>
        </div>
      </div>
    )
  }

  const historial = await listarHistorialAlumno(alumno.id)

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Encabezado />
      <SituacionAcademica
        alumno={alumno}
        historial={historial.ok ? historial.datos : []}
        errorHistorial={historial.ok ? undefined : historial.mensaje}
        rutaReintento="/dashboard/mi-legajo"
      />
      <p className="text-xs text-neutral-400 text-center">
        Si algún dato no es correcto, comunicate con la administración del centro
        educativo.
      </p>
    </div>
  )
}

function Encabezado() {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-2">
        Situación académica
      </p>
      <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">
        Mi legajo académico
      </h1>
      <p className="text-neutral-500 text-sm mt-1 max-w-[64ch]">
        Tu estado, tu curso vigente, el nivel que corresponde a ese curso y tu historial
        completo. Esta vista es de solo lectura.
      </p>
    </div>
  )
}
