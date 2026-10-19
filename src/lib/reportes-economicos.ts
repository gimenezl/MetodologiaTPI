import { z } from 'zod'

export const REPORTES_ECONOMICOS = {
  ingresos: {
    titulo: 'Ingresos por período',
    rf: 'RF17',
    grano: 'Un pago aprobado. El importe informado cuenta una sola vez.',
    descripcion: 'Transferencias aprobadas, con importes informados e imputados separados.',
  },
  completos: {
    titulo: 'Pagos completos',
    rf: 'RF18',
    grano: 'Una relación pago-factura, o una factura sin pago aprobado con saldo cero.',
    descripcion: 'Facturas sin saldo vigente, discriminadas por año calendario y curso a la fecha.',
  },
  incompletos: {
    titulo: 'Pagos incompletos',
    rf: 'RF19',
    grano: 'Una relación pago-factura, o una factura sin ningún pago aprobado.',
    descripcion: 'Facturas con saldo vigente, incluso sin ningún pago aprobado, ubicadas por vencimiento.',
  },
  deportes: {
    titulo: 'Pagos por deporte',
    rf: 'RF20',
    grano: 'Una imputación de ítem deportivo. Los horarios no multiplican el importe.',
    descripcion: 'Imputaciones aprobadas por deporte, nivel, horarios y profesor a cargo.',
  },
  recorridos: {
    titulo: 'Pagos por recorrido',
    rf: 'RF21',
    grano: 'Una imputación de ítem de transporte vinculada a su inscripción.',
    descripcion: 'Imputaciones aprobadas al recorrido referido por el ítem, no al recorrido actual del alumno.',
  },
} as const
export type ReporteEconomico = keyof typeof REPORTES_ECONOMICOS
export function esReporteEconomico(id: string): id is ReporteEconomico {
  return Object.hasOwn(REPORTES_ECONOMICOS, id)
}
export const CAUSAS_CURSO = ['Historial insuficiente', 'Varias matrículas posibles'] as const
const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((valor) => {
    const d = new Date(`${valor}T00:00:00Z`)
    return (
      !Number.isNaN(d.getTime()) &&
      d.toISOString().slice(0, 10) === valor &&
      valor >= '0001-01-01' &&
      valor <= '9998-12-31'
    )
  }, 'La fecha civil no es válida.')
const positivo = z.string().regex(/^[1-9]\d{0,3}$/)
const parametros = z
  .object({
    desde: fecha,
    hasta: fecha,
    pagina: z
      .string()
      .regex(/^[1-9]\d{0,6}$/)
      .default('1')
      .transform(Number)
      .refine((n) => n <= 1_000_000),
    tamano: z.enum(['25', '50', '100']).default('50').transform(Number),
    huella: z
      .string()
      .regex(/^[a-f0-9]{32}$/)
      .optional(),
    anio: positivo.optional(),
    nivel: positivo.optional(),
    curso: z.string().trim().min(1).max(100).optional(),
    causa: z.enum(CAUSAS_CURSO).optional(),
    deporte: z.uuid().optional(),
    recorrido: z.uuid().optional(),
    horario: z.uuid().optional(),
    profesor: z.uuid().optional(),
  })
  .strict()
  .refine((p) => p.desde <= p.hasta, 'La fecha desde debe ser anterior o igual a hasta.')
export type ConsultaEconomica = z.infer<typeof parametros>
export function leerConsultaEconomica(id: ReporteEconomico, url: URLSearchParams) {
  const crudos: Record<string, unknown> = {}
  for (const key of new Set(url.keys())) {
    const valores = url.getAll(key)
    // Un parámetro repetido nunca se normaliza silenciosamente.
    if (
      ![
        'desde',
        'hasta',
        'pagina',
        'tamano',
        'huella',
        'anio',
        'nivel',
        'curso',
        'causa',
        'deporte',
        'recorrido',
        'horario',
        'profesor',
      ].includes(key) ||
      valores.length !== 1
    )
      return { ok: false as const, mensaje: 'No se admiten parámetros repetidos.' }
    if (valores[0] !== '') crudos[key] = valores[0]
  }
  const resultado = parametros.safeParse(crudos)
  if (!resultado.success)
    return {
      ok: false as const,
      mensaje:
        'Revise las fechas, los filtros y la página. Las fechas son inclusivas y deben ser fechas civiles reales.',
    }
  const p = resultado.data
  if ((id !== 'deportes' && (p.deporte || p.horario || p.profesor)) || (id !== 'recorridos' && p.recorrido)) {
    return { ok: false as const, mensaje: 'Uno de los filtros no corresponde a este reporte.' }
  }
  return { ok: true as const, consulta: p }
}
export function argumentosEconomicos(id: ReporteEconomico, consulta: ConsultaEconomica) {
  const { desde, hasta, pagina, tamano, huella, ...filtros } = consulta
  return {
    p_reporte: id,
    p_desde: desde,
    p_hasta: hasta,
    p_pagina: pagina,
    p_tamano: tamano,
    p_filtros: filtros,
    ...(huella ? { p_huella: huella } : {}),
  }
}
const centavos = z.string().regex(/^-?\d+$/)
const curso = z.object({
  curso_id: z.string().nullable(),
  curso: z.string(),
  nivel_id: z.number().nullable(),
  nivel: z.string().nullable(),
  causa: z.enum(CAUSAS_CURSO).nullable(),
})
export const filaEconomica = z.object({
  id: z.string(),
  alumno_id: z.string(),
  alumno: z.string(),
  legajo: z.string().nullable(),
  pago_id: z.string().nullable(),
  factura_id: z.string().nullable(),
  item_id: z.string().nullable(),
  fecha: fecha,
  criterio_fecha: z.enum(['Transferencia', 'Vencimiento']),
  anio: z.number(),
  curso,
  informado_centavos: centavos.nullable(),
  imputado_centavos: centavos,
  diferencia_centavos: centavos.nullable(),
  total_factura_centavos: centavos.nullable(),
  saldo_centavos: centavos.nullable(),
  periodo: z.string().nullable(),
  inconsistente: z.boolean(),
  concepto: z.string().nullable(),
  deporte_id: z.string().nullable(),
  recorrido_id: z.string().nullable(),
  profesor: z.string().nullable(),
  profesor_id: z.string().nullable(),
  nivel_deportivo: z.string().nullable(),
  horarios: z.array(z.object({ id: z.string(), dia: z.number(), desde: z.string(), hasta: z.string() })),
})
export const documentoEconomico = z.object({
  filas: z.array(filaEconomica),
  total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  pagina: z.number().int().positive(),
  tamano: z.number().int().positive(),
  huella: z.string().regex(/^[a-f0-9]{32}$/),
  leido_en: z.string(),
  fecha_corte: fecha,
  totales: z.object({
    informado_centavos: centavos.nullable(),
    imputado_centavos: centavos,
    diferencia_centavos: centavos.nullable(),
    facturas: z.number().int().nonnegative(),
    total_facturas_centavos: centavos,
    saldo_facturas_centavos: centavos,
  }),
  grupos: z.array(
    z.object({
      anio: z.number(),
      nivel: z.string().nullable(),
      curso: z.string(),
      causa: z.string().nullable(),
      concepto: z.string().nullable(),
      filas: z.number(),
      imputado_centavos: centavos,
    })
  ),
})
export type DocumentoEconomico = z.infer<typeof documentoEconomico>
export type FilaEconomica = z.infer<typeof filaEconomica>
/** Formato exacto: nunca convertir centavos a Number, ni siquiera para presentar. */
export function dineroEconomico(valor: string | null): string {
  if (valor === null) return 'No atribuible'
  if (!/^-?\d+$/.test(valor)) throw new Error('Importe inválido')
  const n = BigInt(valor),
    absoluto = n < BigInt(0) ? -n : n
  return `${n < BigInt(0) ? '-' : ''}$ ${(absoluto / BigInt(100)).toLocaleString('es-AR')},${String(absoluto % BigInt(100)).padStart(2, '0')}`
}
/** DATE no pasa por el reloj local ni por Intl.DateTimeFormat de un instante UTC. */
export function fechaEconomica(valor: string) {
  return valor.split('-').reverse().join('/')
}
export function urlConsultaEconomica(consulta: ConsultaEconomica, cambio: Partial<ConsultaEconomica> = {}) {
  return new URLSearchParams(
    Object.entries({ ...consulta, ...cambio })
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)])
  )
}
