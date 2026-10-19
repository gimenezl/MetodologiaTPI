import { NextResponse } from 'next/server'
import { esReporteEconomico, leerConsultaEconomica } from '@/lib/reportes-economicos'
import { requerirDirector } from '@/services/autorizacion'
import { leerReporteEconomico } from '@/services/reportes-economicos.service'
import { SIN_CACHE } from '@/services/usuarios.respuestas'

export async function GET(request: Request, { params }: { params: Promise<{ reporte: string }> }) {
  const permiso = await requerirDirector('Solo Dirección habilitada puede consultar los reportes económicos.')
  const responder = (body: unknown, status: number) => NextResponse.json(body, { status, headers: SIN_CACHE })
  if (!permiso.autorizado)
    return responder({ error: permiso.mensaje, codigo: permiso.codigo ?? 'ACCESO_DENEGADO' }, permiso.estado)
  const { reporte } = await params
  if (!esReporteEconomico(reporte)) return responder({ error: 'El reporte solicitado no existe.' }, 404)
  const parametros = leerConsultaEconomica(reporte, new URL(request.url).searchParams)
  if (!parametros.ok) return responder({ error: parametros.mensaje }, 400)
  const resultado = await leerReporteEconomico(reporte, parametros.consulta)
  return resultado.ok ? responder(resultado.datos, 200) : responder({ error: resultado.mensaje }, resultado.estado)
}
