'use client'

import { useMemo } from 'react'
import { ForkKnife } from '@phosphor-icons/react'
import { ListaInscripcionesAdministrativas } from '@/components/inscripciones/ListaInscripcionesAdministrativas'
import {
  confirmacionDe,
  textoDeBusqueda,
  type FilaInscripcion,
} from '@/components/inscripciones/tipos'
import { nombreAlumno } from '@/components/inscripciones/formato'
import type { ServicioEscolar } from '@/services/comedor.service'
import type { InscripcionServicioAdministracion } from '@/services/inscripciones-administracion.service'

interface InscriptosComedorProps {
  servicio: ServicioEscolar | null
  inscripciones: InscripcionServicioAdministracion[]
}

/** Las fechas se formatean con `components/inscripciones/formato`: zona y reloj de 24 h fijos, para que servidor y navegador coincidan. */

function aFila(inscripcion: InscripcionServicioAdministracion): FilaInscripcion {
  const alumno = nombreAlumno(inscripcion.alumno_apellido, inscripcion.alumno_nombre)
  return {
    id: inscripcion.id,
    alumno,
    legajo: inscripcion.legajo_nro,
    detalles: {},
    descripcion: inscripcion.servicio_nombre,
    estado: inscripcion.estado,
    fechaAlta: inscripcion.fecha_inscripcion,
    fechaBaja: inscripcion.fecha_cancelacion,
    confirmacion: confirmacionDe(inscripcion),
    busqueda: textoDeBusqueda(alumno, inscripcion.legajo_nro),
  }
}

/**
 * Administración de las inscripciones al comedor por Dirección (EPT-28, EPT-62).
 *
 * Dirección consulta a los alumnos inscriptos con su legajo, el estado de cada
 * inscripción (activa o cancelada) y, aparte, su confirmación. Puede confirmar
 * una inscripción vigente y cancelarla en nombre del alumno. Nada se elimina: la
 * cancelación es una baja lógica que conserva el historial y la confirmación
 * previa. Las filas que se ven son exactamente las que la vista administrativa
 * devuelve a Dirección; no hay ningún filtro de autorización acá.
 */
export function InscriptosComedor({ servicio, inscripciones }: InscriptosComedorProps) {
  const filas = useMemo(() => inscripciones.map(aFila), [inscripciones])

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-2">
          Servicios escolares
        </p>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">Comedor</h1>
        <p className="text-neutral-600 text-sm mt-1 max-w-[72ch]">
          Alumnos inscriptos a {servicio?.nombre ?? 'el comedor escolar'}, con su legajo, el
          estado de cada inscripción y su confirmación. Podés confirmar una inscripción o
          cancelarla en nombre del alumno: la cancelación conserva el historial y el alumno
          puede volver a inscribirse.
        </p>
      </div>

      <ListaInscripcionesAdministrativas
        dominio="comedor"
        filas={filas}
        columnas={[]}
        caption="Alumnos inscriptos al comedor con legajo, estado, confirmación, fechas y acciones"
        filtroEstado={{
          etiquetaGrupo: 'Filtrar inscripciones por estado',
          etiquetas: { ACTIVAS: 'Inscriptos', CANCELADAS: 'Bajas', TODAS: 'Todas' },
        }}
        busqueda={{
          etiqueta: 'Buscar por apellido o legajo',
          placeholder: 'Apellido o número de legajo',
        }}
        etiquetaResumen="Resumen de inscripciones al comedor"
        resumen={({ visibles, total, activas }) =>
          `${
            activas === 1
              ? '1 alumno con inscripción activa.'
              : `${activas} alumnos con inscripción activa.`
          } Se muestran ${visibles} de ${total} registros.`
        }
        vacio={{
          icono: <ForkKnife size={40} className="text-neutral-300 mx-auto mb-3" aria-hidden="true" />,
          titulo: 'No hay inscripciones que coincidan',
          ayuda: 'Probá con otro estado, con otra confirmación o con otro término de búsqueda.',
        }}
      />
    </div>
  )
}
