import { expect, test } from '@playwright/test'
import {
  esFechaValida,
  mensajeDeRegistro,
  primerErrorAsistencia,
  registroAsistenciaSchema,
  traducirErrorDeAsistencia,
} from '@/lib/asistencias'

/** Lógica pura de las asistencias por vínculo vigente (EPT-66 D), sin base ni navegador. */

const ALUMNO = 'e2e66d00-0000-4000-8000-0000000000a1'

test.describe('traducción de errores', () => {
  const casos: Array<[string | undefined, number, string]> = [
    ['P5505', 401, 'NO_AUTENTICADO'],
    ['42501', 403, 'SIN_PERMISO'],
    ['P6610', 404, 'ALUMNO_NO_DISPONIBLE'],
    ['P6611', 400, 'DATOS_INVALIDOS'],
    ['40P01', 409, 'CONFLICTO'],
    ['40001', 409, 'CONFLICTO'],
    ['55P03', 409, 'CONFLICTO'],
    ['XX000', 500, 'ERROR_INESPERADO'],
    [undefined, 500, 'ERROR_INESPERADO'],
  ]
  for (const [code, estado, codigo] of casos) {
    test(`${code ?? 'sin código'} → ${estado} ${codigo}`, () => {
      const traducido = traducirErrorDeAsistencia({ code, message: 'texto técnico en inglés' })
      expect(traducido.estado).toBe(estado)
      expect(traducido.codigo).toBe(codigo)
    })
  }

  test('ningún mensaje filtra texto de PostgreSQL, SQLSTATE ni nombres de tablas', () => {
    for (const code of ['P5505', '42501', 'P6610', 'P6611', 'P6612', '40P01', 'otro', undefined]) {
      const { mensaje } = traducirErrorDeAsistencia({
        code,
        message: 'new row violates row-level security policy for table "asistencias"',
      })
      expect(mensaje).not.toMatch(/row-level|violates|policy|table "|"asistencias"|public\.|P66\d\d|42501/u)
    }
  })

  test('el alumno inexistente, ajeno o sin vínculo recibe una sola respuesta', () => {
    expect(traducirErrorDeAsistencia({ code: 'P6610' }).mensaje).toBe(
      'El alumno ya no está a tu cargo o no está disponible. Actualizamos la lista.'
    )
  })

  test('el texto del éxito refleja lo que hizo la base', () => {
    expect(mensajeDeRegistro('CREADA')).toBe('Asistencia registrada')
    expect(mensajeDeRegistro('ACTUALIZADA')).toBe('Asistencia actualizada')
    expect(mensajeDeRegistro('SIN_CAMBIOS')).toBe('La asistencia ya tenía ese estado')
  })
})

test.describe('fecha y cuerpo del registro', () => {
  test('la fecha debe existir en el calendario', () => {
    for (const valida of ['2031-03-10', '2028-02-29', '2031-12-31']) expect(esFechaValida(valida)).toBe(true)
    for (const invalida of ['2031-02-31', '2031-13-01', '2031-3-1', '31/03/2031', '', null, undefined, 20310310]) {
      expect(esFechaValida(invalida)).toBe(false)
    }
  })

  test('acepta alumno, fecha y estado válidos', () => {
    for (const estado of ['PRESENTE', 'AUSENTE', 'JUSTIFICADO']) {
      expect(registroAsistenciaSchema.safeParse({ estudiante_id: ALUMNO, fecha: '2031-03-10', estado }).success).toBe(true)
    }
  })

  test('rechaza cualquier campo de identidad: el registrante no viaja en el cuerpo', () => {
    for (const extra of [{ docente_id: ALUMNO }, { registrante: 'x' }, { perfil_id: ALUMNO }, { rol: 'DIRECTOR' }]) {
      const resultado = registroAsistenciaSchema.safeParse({
        estudiante_id: ALUMNO,
        fecha: '2031-03-10',
        estado: 'PRESENTE',
        ...extra,
      })
      expect(resultado.success).toBe(false)
      if (!resultado.success) {
        expect(primerErrorAsistencia(resultado.error).mensaje).toBe('La petición contiene campos no permitidos')
      }
    }
  })

  test('cada campo inválido informa su propio mensaje y campo', () => {
    const casos: Array<[Record<string, unknown>, string, string]> = [
      [{ estudiante_id: 'no-es-uuid', fecha: '2031-03-10', estado: 'PRESENTE' }, 'estudiante_id', 'Seleccioná un alumno'],
      [{ estudiante_id: ALUMNO, fecha: '2031-02-31', estado: 'PRESENTE' }, 'fecha', 'La fecha no es válida'],
      [{ estudiante_id: ALUMNO, fecha: '2031-03-10', estado: 'TARDE' }, 'estado', 'Elegí un estado de asistencia válido'],
      [{ fecha: '2031-03-10', estado: 'PRESENTE' }, 'estudiante_id', 'Seleccioná un alumno'],
    ]
    for (const [cuerpo, campo, mensaje] of casos) {
      const resultado = registroAsistenciaSchema.safeParse(cuerpo)
      expect(resultado.success).toBe(false)
      if (!resultado.success) expect(primerErrorAsistencia(resultado.error)).toEqual({ mensaje, campo })
    }
  })
})
