import { expect, test } from '@playwright/test'
import {
  actualizarTarifaSchema,
  agruparTarifas,
  cambiarTarifaSchema,
  crearTarifaSchema,
  diaAnterior,
  esFechaIsoReal,
  esImporteCanonico,
  estadoDeVersion,
  formatearFecha,
  formatearImporteArs,
  hoyEnArgentina,
  importeParaCampo,
  normalizarImporte,
  primerErrorTarifas,
  referenciaDe,
  textoVigencia,
  tarifaIdSchema,
} from '@/lib/tarifas'

/** Contrato puro de las tarifas (EPT-103): dinero como texto exacto, vigencias cerradas, esquemas. */

const NIVEL = '2'
const DEPORTE = 'e0000000-0000-4000-8000-000000000101'

test.describe('normalizarImporte: dinero como texto, sin Number ni redondeo', () => {
  const validos: Array<[string, string]> = [
    ['0', '0'],
    ['0,00', '0.00'],
    ['0.5', '0.5'],
    ['10', '10'],
    ['10,5', '10.5'],
    ['10.50', '10.50'],
    ['1234,50', '1234.50'],
    ['  1234.5  ', '1234.5'],
    ['9999999999,99', '9999999999.99'],
    ['9999999999', '9999999999'],
    // Más dígitos de los que un doble de IEEE 754 representa con exactitud.
    ['1234567890,12', '1234567890.12'],
  ]
  for (const [entrada, esperado] of validos) {
    test(`acepta «${entrada}» como ${esperado}`, () => {
      expect(normalizarImporte(entrada)).toEqual({ ok: true, valor: esperado })
    })
  }

  const rechazados: Array<[unknown, RegExp]> = [
    // Precisión: 10.005 no se redondea a 10.01.
    ['10.005', /dos decimales/u],
    ['10,001', /dos decimales/u],
    ['10.000', /dos decimales/u],
    ['0,001', /dos decimales/u],
    // Capacidad.
    ['10000000000', /máximo/u],
    ['99999999999,99', /máximo/u],
    // Signo.
    ['-1', /negativo/u],
    ['-0,01', /negativo/u],
    ['-0', /negativo/u],
    // Valores no finitos y notación científica.
    ['NaN', /formato/u],
    ['Infinity', /formato/u],
    ['-Infinity', /formato/u],
    ['1e3', /formato/u],
    ['1E-2', /formato/u],
    ['0x10', /formato/u],
    // Ambiguos: no se interpretan separadores de miles.
    ['1.234,50', /ambiguo|separadores/u],
    ['1,234.50', /separadores/u],
    ['1.234.567', /separadores/u],
    ['1,2,3', /separadores/u],
    // Basura.
    ['', /Ingresá/u],
    ['   ', /Ingresá/u],
    ['abc', /formato/u],
    ['$10', /formato/u],
    ['10 ARS', /formato/u],
    ['1 000', /formato/u],
    ['+10', /formato/u],
    ['1,', /formato/u],
    [',5', /formato/u],
    ['.', /formato/u],
    ['007', /ceros/u],
    ['01,50', /ceros/u],
    ['１０', /formato/u],
    [null, /Ingresá/u],
    [undefined, /Ingresá/u],
    [10, /Ingresá/u],
  ]
  for (const [entrada, mensaje] of rechazados) {
    test(`rechaza ${JSON.stringify(entrada)}`, () => {
      const resultado = normalizarImporte(entrada)
      expect(resultado.ok).toBe(false)
      if (!resultado.ok) expect(resultado.mensaje).toMatch(mensaje)
    })
  }

  test('lo que acepta siempre cumple el formato canónico de la base', () => {
    for (const [entrada] of validos) {
      const resultado = normalizarImporte(entrada)
      expect(resultado.ok && esImporteCanonico(resultado.valor)).toBe(true)
    }
  })
})

test.describe('presentación es-AR sin Intl ni float', () => {
  test('formatea miles con punto y decimales con coma, siempre con dos decimales', () => {
    expect(formatearImporteArs('0')).toBe('$ 0,00')
    expect(formatearImporteArs('0.00')).toBe('$ 0,00')
    expect(formatearImporteArs('5.5')).toBe('$ 5,50')
    expect(formatearImporteArs('999.99')).toBe('$ 999,99')
    expect(formatearImporteArs('1000.00')).toBe('$ 1.000,00')
    expect(formatearImporteArs('1234567.89')).toBe('$ 1.234.567,89')
    expect(formatearImporteArs('9999999999.99')).toBe('$ 9.999.999.999,99')
  })

  test('conserva todos los dígitos de un importe que un doble no representa', () => {
    expect(formatearImporteArs('1234567890.12')).toBe('$ 1.234.567.890,12')
    // 2^53 + 1 con centavos: un doble ya no lo distingue de 2^53; el texto sí.
    expect(formatearImporteArs('9007199254740993.01')).toBe('$ 9.007.199.254.740.993,01')
  })

  test('un valor con otra forma se devuelve tal cual, nunca NaN', () => {
    expect(formatearImporteArs('NaN')).toBe('NaN')
    expect(formatearImporteArs('')).toBe('')
    expect(formatearImporteArs('1e3')).toBe('1e3')
  })

  test('el valor de un campo editable usa coma y no agrupa miles', () => {
    expect(importeParaCampo('1234.50')).toBe('1234,50')
    expect(importeParaCampo('0.00')).toBe('0,00')
    expect(importeParaCampo('7')).toBe('7,00')
  })

  test('ida y vuelta: lo que se muestra en el campo se vuelve a aceptar', () => {
    for (const valor of ['0.00', '10.50', '1234567.89', '9999999999.99']) {
      const resultado = normalizarImporte(importeParaCampo(valor))
      expect(resultado).toEqual({ ok: true, valor })
    }
  })
})

test.describe('fechas de calendario', () => {
  test('reconoce solo fechas reales AAAA-MM-DD', () => {
    expect(esFechaIsoReal('2029-07-01')).toBe(true)
    expect(esFechaIsoReal('2028-02-29')).toBe(true)
    expect(esFechaIsoReal('2029-02-29')).toBe(false)
    expect(esFechaIsoReal('2029-02-30')).toBe(false)
    expect(esFechaIsoReal('2029-13-01')).toBe(false)
    expect(esFechaIsoReal('2029-00-10')).toBe(false)
    expect(esFechaIsoReal('2029-7-1')).toBe(false)
    expect(esFechaIsoReal('01/07/2029')).toBe(false)
    expect(esFechaIsoReal('infinity')).toBe(false)
    expect(esFechaIsoReal('-infinity')).toBe(false)
    expect(esFechaIsoReal('')).toBe(false)
    expect(esFechaIsoReal(null)).toBe(false)
    expect(esFechaIsoReal('2029-07-01T00:00:00Z')).toBe(false)
  })

  test('formatea a mano, sin Intl', () => {
    expect(formatearFecha('2029-07-01')).toBe('01/07/2029')
    expect(formatearFecha('basura')).toBe('basura')
  })

  test('el día anterior respeta fin de mes, de año y bisiestos', () => {
    expect(diaAnterior('2029-07-01')).toBe('2029-06-30')
    expect(diaAnterior('2030-01-01')).toBe('2029-12-31')
    expect(diaAnterior('2028-03-01')).toBe('2028-02-29')
    expect(diaAnterior('2029-03-01')).toBe('2029-02-28')
  })

  test('describe la vigencia cerrada: ambos extremos incluidos, hasta vacío = sin fin', () => {
    expect(textoVigencia('2029-07-01', '2029-12-31')).toBe('Del 01/07/2029 al 31/12/2029')
    expect(textoVigencia('2029-07-01', null)).toBe('Desde el 01/07/2029, sin fecha de fin')
  })

  test('estado de una versión con extremos inclusivos', () => {
    const v = { desde: '2029-07-01', hasta: '2029-07-31' }
    expect(estadoDeVersion(v, '2029-06-30')).toBe('FUTURA')
    expect(estadoDeVersion(v, '2029-07-01')).toBe('VIGENTE')
    expect(estadoDeVersion(v, '2029-07-31')).toBe('VIGENTE')
    expect(estadoDeVersion(v, '2029-08-01')).toBe('FINALIZADA')
    expect(estadoDeVersion({ desde: '2029-07-01', hasta: null }, '2099-01-01')).toBe('VIGENTE')
  })

  test('hoy en Argentina usa UTC-3, también en el cruce de día', () => {
    expect(hoyEnArgentina(new Date('2029-07-01T02:59:59Z'))).toBe('2029-06-30')
    expect(hoyEnArgentina(new Date('2029-07-01T03:00:00Z'))).toBe('2029-07-01')
  })
})

test.describe('referencias', () => {
  test('la cuota usa el id entero del nivel y el resto un UUID', () => {
    expect(referenciaDe('CUOTA', NIVEL)).toEqual({ nivel_id: 2, deporte_id: null, servicio_id: null })
    expect(referenciaDe('DEPORTE', DEPORTE)).toEqual({ nivel_id: null, deporte_id: DEPORTE, servicio_id: null })
    expect(referenciaDe('TRANSPORTE', DEPORTE)).toEqual({ nivel_id: null, deporte_id: null, servicio_id: DEPORTE })
    expect(referenciaDe('COMEDOR', DEPORTE.toUpperCase())).toEqual({
      nivel_id: null,
      deporte_id: null,
      servicio_id: DEPORTE,
    })
  })

  test('rechaza una referencia con la forma de otro concepto', () => {
    expect(referenciaDe('CUOTA', DEPORTE)).toBeNull()
    expect(referenciaDe('DEPORTE', NIVEL)).toBeNull()
    expect(referenciaDe('CUOTA', '0')).toBeNull()
    expect(referenciaDe('CUOTA', '-1')).toBeNull()
    expect(referenciaDe('CUOTA', '2.5')).toBeNull()
    expect(referenciaDe('CUOTA', '99999999999')).toBeNull()
    expect(referenciaDe('CUOTA', '')).toBeNull()
    expect(referenciaDe('TRANSPORTE', 'no-es-un-uuid')).toBeNull()
  })
})

test.describe('esquemas de entrada', () => {
  const alta = { concepto: 'DEPORTE', referencia_id: DEPORTE, importe: '1234,5', desde: '2029-07-01', hasta: '' }

  test('el alta normaliza el importe y trata «hasta» vacío como sin fin', () => {
    const resultado = crearTarifaSchema.safeParse(alta)
    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(resultado.data.importe).toBe('1234.5')
      expect(resultado.data.hasta).toBeNull()
    }
    expect(crearTarifaSchema.safeParse({ ...alta, hasta: null }).success).toBe(true)
    const sinHasta: Record<string, unknown> = { ...alta }
    delete sinHasta.hasta
    expect(crearTarifaSchema.safeParse(sinHasta).success).toBe(true)
  })

  test('cero es un importe válido', () => {
    const resultado = crearTarifaSchema.safeParse({ ...alta, importe: '0' })
    expect(resultado.success && resultado.data.importe).toBe('0')
  })

  test('rechaza campos de identidad: el actor sale de la sesión, no del cuerpo', () => {
    for (const intruso of ['actor_id', 'user_id', 'rol', 'perfil_id', 'user_metadata', 'role']) {
      const resultado = crearTarifaSchema.safeParse({ ...alta, [intruso]: 'DIRECTOR' })
      expect(resultado.success, intruso).toBe(false)
      if (!resultado.success) {
        expect(primerErrorTarifas(resultado.error).mensaje).toBe('La petición contiene campos no permitidos')
      }
    }
    expect(actualizarTarifaSchema.safeParse({
      importe: '1', desde: '2029-07-01', hasta: null, actor: 'x',
      previo: { importe: '1', desde: '2029-07-01', hasta: null },
    }).success).toBe(false)
  })

  test('rechaza un importe inválido indicando el campo importe', () => {
    const resultado = crearTarifaSchema.safeParse({ ...alta, importe: '10.005' })
    expect(resultado.success).toBe(false)
    if (!resultado.success) {
      expect(primerErrorTarifas(resultado.error)).toEqual({
        mensaje: 'El importe admite como máximo dos decimales.',
        campo: 'importe',
      })
    }
  })

  test('rechaza fechas imposibles e infinitas', () => {
    for (const desde of ['2029-02-30', 'infinity', '-infinity', '', '1/7/2029', 'ayer']) {
      const resultado = crearTarifaSchema.safeParse({ ...alta, desde })
      expect(resultado.success, desde).toBe(false)
      if (!resultado.success) expect(primerErrorTarifas(resultado.error).campo).toBe('desde')
    }
    const hasta = crearTarifaSchema.safeParse({ ...alta, hasta: 'infinity' })
    expect(hasta.success).toBe(false)
    if (!hasta.success) expect(primerErrorTarifas(hasta.error).campo).toBe('hasta')
  })

  test('hasta anterior a desde se rechaza; hasta igual a desde (un día) se acepta', () => {
    const antes = crearTarifaSchema.safeParse({ ...alta, hasta: '2029-06-30' })
    expect(antes.success).toBe(false)
    if (!antes.success) expect(primerErrorTarifas(antes.error)).toEqual({
      mensaje: 'La fecha de fin no puede ser anterior a la de inicio.',
      campo: 'hasta',
    })
    expect(crearTarifaSchema.safeParse({ ...alta, hasta: '2029-07-01' }).success).toBe(true)
  })

  test('la referencia debe tener la forma del concepto', () => {
    const resultado = crearTarifaSchema.safeParse({ ...alta, concepto: 'CUOTA' })
    expect(resultado.success).toBe(false)
    if (!resultado.success) expect(primerErrorTarifas(resultado.error).campo).toBe('referencia_id')
    expect(crearTarifaSchema.safeParse({ ...alta, concepto: 'CUOTA', referencia_id: NIVEL }).success).toBe(true)
  })

  test('el concepto debe ser uno de los cuatro: no hay cargos adicionales', () => {
    for (const concepto of ['MATRICULA', 'cuota', '', 'EXTRA']) {
      const resultado = crearTarifaSchema.safeParse({ ...alta, concepto })
      expect(resultado.success, concepto).toBe(false)
      if (!resultado.success) expect(primerErrorTarifas(resultado.error).campo).toBe('concepto')
    }
  })

  test('el cambio de precio tiene la misma forma que el alta', () => {
    expect(cambiarTarifaSchema.safeParse(alta).success).toBe(true)
  })

  test('la edición exige los valores previos y no acepta concepto ni referencia', () => {
    const edicion = {
      importe: '2000',
      desde: '2029-07-01',
      hasta: null,
      previo: { importe: '1234.50', desde: '2029-07-01', hasta: null },
    }
    expect(actualizarTarifaSchema.safeParse(edicion).success).toBe(true)
    const sinPrevio: Record<string, unknown> = { ...edicion }
    delete sinPrevio.previo
    expect(actualizarTarifaSchema.safeParse(sinPrevio).success).toBe(false)
    expect(actualizarTarifaSchema.safeParse({ ...edicion, concepto: 'CUOTA' }).success).toBe(false)
    expect(actualizarTarifaSchema.safeParse({ ...edicion, referencia_id: NIVEL }).success).toBe(false)
  })

  test('el identificador de tarifa debe ser un UUID', () => {
    expect(tarifaIdSchema.safeParse(DEPORTE).success).toBe(true)
    expect(tarifaIdSchema.safeParse('1').success).toBe(false)
    expect(tarifaIdSchema.safeParse("1' OR '1'='1").success).toBe(false)
  })

  test('un cuerpo que no es un objeto se rechaza sin detalle técnico', () => {
    for (const cuerpo of [null, 'texto', 5, [], undefined]) {
      const resultado = crearTarifaSchema.safeParse(cuerpo)
      expect(resultado.success).toBe(false)
      if (!resultado.success) expect(primerErrorTarifas(resultado.error).mensaje).toBe('Datos inválidos')
    }
  })
})

test.describe('agrupación del catálogo con las tarifas', () => {
  const catalogos = {
    CUOTA: [{ referencia_id: '1', nombre: 'INICIAL', detalle: null, activa: true }],
    DEPORTE: [{ referencia_id: DEPORTE, nombre: 'Fútbol', detalle: null, activa: true }],
    TRANSPORTE: [],
    COMEDOR: [{ referencia_id: 'c', nombre: 'Comedor escolar', detalle: 'COMEDOR', activa: true }],
  }

  test('una referencia sin tarifas aparece con la lista vacía y las versiones van de la más reciente a la más antigua', () => {
    const grupos = agruparTarifas(catalogos, [
      { id: 'a', concepto: 'DEPORTE', referencia_id: DEPORTE, importe: '100.00', desde: '2029-01-01', hasta: '2029-06-30' },
      { id: 'b', concepto: 'DEPORTE', referencia_id: DEPORTE, importe: '120.00', desde: '2029-07-01', hasta: null },
      { id: 'c', concepto: 'CUOTA', referencia_id: DEPORTE, importe: '1.00', desde: '2029-01-01', hasta: null },
    ])
    expect(grupos.map((g) => g.concepto)).toEqual(['CUOTA', 'DEPORTE', 'TRANSPORTE', 'COMEDOR'])
    expect(grupos[0].referencias[0].versiones).toEqual([])
    expect(grupos[1].referencias[0].versiones.map((v) => v.id)).toEqual(['b', 'a'])
    expect(grupos[2].referencias).toEqual([])
    expect(grupos[3].referencias[0].versiones).toEqual([])
  })
})
