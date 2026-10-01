import { notFound } from 'next/navigation'
import { AuditoriaAccesos } from '@/components/accesos/AuditoriaAccesos'
import { EscanerAcceso } from '@/components/accesos/EscanerAcceso'
import type { FilaAcceso, ServicioEscaneable } from '@/lib/accesos-qr/tipos'

/**
 * Banco visual determinista del registro de accesos con QR (EPT-65).
 *
 * Solo existe en desarrollo y además exige la variable que Playwright define para
 * los harness de interfaz: `next.config.ts` no compila las páginas `page.banco.tsx`
 * en producción, y esta guarda en tiempo de ejecución se conserva por si alguien
 * cambiara esa configuración.
 *
 * Los datos son sintéticos: personas y servicios inventados. Las pruebas de
 * interfaz interceptan `fetch` para simular cada respuesta de la API (éxito,
 * denegación, límite, tiempo agotado). El banco demuestra la PRESENTACIÓN, la
 * accesibilidad y el manejo de cámara; NO demuestra autorización ni persistencia:
 * eso lo prueban `accesos-qr-auth.spec.ts`, `accesos_servicios_rls.sql` y
 * `accesos_servicios_concurrencia.mjs`.
 */
export const dynamic = 'force-dynamic'

const SERVICIOS: ServicioEscaneable[] = [
  { id: 'e0000000-0000-4000-8000-000000000010', tipo: 'COMEDOR', codigo: 'COMEDOR', nombre: 'Comedor escolar' },
  { id: 'e0000000-0000-4000-8000-000000000020', tipo: 'TRANSPORTE', codigo: 'TR-NORTE', nombre: 'Recorrido Norte (ficticio)' },
  { id: 'e0000000-0000-4000-8000-000000000021', tipo: 'TRANSPORTE', codigo: 'TR-SUR', nombre: 'Recorrido Sur (ficticio)' },
]

const FILAS: FilaAcceso[] = [
  {
    id: 'f0000000-0000-4000-8000-000000000001',
    registrado_en: '2026-10-05T15:02:11.000Z',
    hora: '12:02:11',
    dia_servicio: '2026-10-05',
    resultado: 'REGISTRADO',
    motivo_denegacion: null,
    servicio_nombre: 'Comedor escolar',
    servicio_tipo: 'COMEDOR',
    sentido: null,
    alumno_nombre: 'Lucía',
    alumno_apellido: 'Ejemplo Ficticia',
    alumno_legajo: 'LEG-PRUEBA-0065',
    operador_nombre: 'Paula Personal Ficticia',
    anulado: false,
    anulado_motivo: null,
    anonimizado: false,
  },
  {
    id: 'f0000000-0000-4000-8000-000000000002',
    registrado_en: '2026-10-05T14:40:00.000Z',
    hora: '11:40:00',
    dia_servicio: '2026-10-05',
    resultado: 'DENEGADO',
    motivo_denegacion: 'SIN_INSCRIPCION',
    servicio_nombre: 'Recorrido Norte (ficticio)',
    servicio_tipo: 'TRANSPORTE',
    sentido: 'IDA',
    alumno_nombre: 'Mateo',
    alumno_apellido: 'Ficticio Prueba',
    alumno_legajo: 'LEG-PRUEBA-0066',
    operador_nombre: 'Paula Personal Ficticia',
    anulado: false,
    anulado_motivo: null,
    anonimizado: false,
  },
  {
    id: 'f0000000-0000-4000-8000-000000000003',
    registrado_en: '2026-10-05T13:15:30.000Z',
    hora: '10:15:30',
    dia_servicio: '2026-10-05',
    resultado: 'REGISTRADO',
    motivo_denegacion: null,
    servicio_nombre: 'Recorrido Sur (ficticio)',
    servicio_tipo: 'TRANSPORTE',
    sentido: 'VUELTA',
    alumno_nombre: 'Sofía',
    alumno_apellido: 'Ejemplo Anulada',
    alumno_legajo: 'LEG-PRUEBA-0067',
    operador_nombre: 'Ana Directora Ficticia',
    anulado: true,
    anulado_motivo: 'Se escaneó la credencial de otra persona',
    anonimizado: false,
  },
]

export default async function BancoAccesos({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string }>
}) {
  if (process.env.NODE_ENV === 'production' || process.env.EPT_UI_HARNESS !== '1') {
    notFound()
  }

  const { vista = 'escaner' } = await searchParams

  if (vista === 'auditoria') {
    return (
      <div className="mx-auto max-w-4xl space-y-6 p-4">
        <h1 className="text-2xl font-extrabold tracking-tight text-neutral-900">Auditoría de accesos</h1>
        <AuditoriaAccesos
          filas={FILAS}
          total={31}
          pagina={1}
          tamano={25}
          filtros={{ dia: '2026-10-05', resultado: '', servicio: '' }}
          servicios={SERVICIOS}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <h1 className="text-2xl font-extrabold tracking-tight text-neutral-900">Registrar accesos</h1>
      <EscanerAcceso servicios={vista === 'sin-comedor' ? SERVICIOS.slice(1) : SERVICIOS} />
    </div>
  )
}
