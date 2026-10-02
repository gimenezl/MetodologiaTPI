import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import {
  inscripcionDesdeFila,
  mensajeDeAlta,
  mensajeDeBaja,
  mensajeDeLectura,
  ocupacionPorActividad,
} from '@/lib/inscripciones-legadas'

/** Lógica pura de las inscripciones legadas (EPT-66), sin base ni navegador. */

test.describe('traducción de errores', () => {
  const alta: Array<[string | undefined, string]> = [
    ['P5582', 'Las inscripciones deportivas se hacen por grupo en la sección Deportes.'],
    ['23505', 'Este alumno ya está inscripto en esta actividad.'],
    ['23514', 'El cupo para esta actividad está completo.'],
    ['P6603', 'La actividad solicitada no existe.'],
    ['P6604', 'La actividad no está disponible para inscribirse.'],
    ['P6602', 'El alumno solicitado no está disponible.'],
    ['42501', 'Tu rol no puede gestionar inscripciones a actividades.'],
    ['P5505', 'Tu sesión venció. Volvé a iniciar sesión.'],
    ['XX000', 'No se pudo inscribir al alumno. Intentá nuevamente.'],
    [undefined, 'No se pudo inscribir al alumno. Intentá nuevamente.'],
  ]
  for (const [code, mensaje] of alta) {
    test(`alta ${code ?? 'sin código'}`, () => {
      expect(mensajeDeAlta({ code, message: 'texto técnico en inglés' })).toBe(mensaje)
    })
  }

  test('baja y lectura nunca filtran el mensaje de PostgREST', () => {
    for (const code of ['P5582', 'P6607', 'P6602', '42501', 'P5505', 'otro']) {
      expect(mensajeDeBaja({ code, message: 'permission denied for table inscripciones' }))
        .not.toMatch(/permission denied|relation|table "/u)
      expect(mensajeDeLectura({ code, message: 'permission denied for table inscripciones' }))
        .not.toMatch(/permission denied|relation|table "/u)
    }
    expect(mensajeDeBaja({ code: 'P6607' })).toBe('La inscripción ya estaba dada de baja.')
    expect(mensajeDeBaja({ code: 'P5582' })).toBe('Las inscripciones deportivas anteriores son históricas y no se pueden modificar.')
  })
})

test('una fila se convierte en la forma que usan las pantallas', () => {
  const resultado = inscripcionDesdeFila({
    id: 'i1', estudiante_id: 'e1', actividad_id: 7, estado: 'BAJA',
    fecha_inscripcion: '2026-10-02T12:00:00Z', fecha_baja: '2026-10-03T12:00:00Z',
    actividad_nombre: 'Taller', actividad_tipo: 'TALLER', cupo_maximo: 12,
  })
  expect(resultado).toEqual({
    id: 'i1', estudiante_id: 'e1', actividad_id: 7, estado: 'BAJA',
    fecha_inscripcion: '2026-10-02T12:00:00Z', fecha_baja: '2026-10-03T12:00:00Z',
    actividad: { nombre: 'Taller', tipo: 'TALLER', cupo_maximo: 12 },
  })
  expect(inscripcionDesdeFila({ ...{ id: 'i', estudiante_id: 'e', actividad_id: 1, fecha_inscripcion: 'x', fecha_baja: null, actividad_nombre: 'a', actividad_tipo: null, cupo_maximo: 1 }, estado: 'cualquier-cosa' }).estado)
    .toBe('ACTIVO')
})

test('la ocupación agregada tolera filas ausentes y valores no numéricos', () => {
  const mapa = ocupacionPorActividad([{ actividad_id: 1, inscriptos: 3 }, { actividad_id: 2, inscriptos: Number('x') }])
  expect(mapa.get(1)).toBe(3)
  expect(mapa.get(2)).toBe(0)
  expect(mapa.get(99)).toBeUndefined()
  expect(ocupacionPorActividad(null).size).toBe(0)
})

test.describe('la aplicación no accede a `inscripciones` de forma directa', () => {
  function archivos(directorio: string): string[] {
    return readdirSync(directorio).flatMap((nombre) => {
      const ruta = path.join(directorio, nombre)
      return statSync(ruta).isDirectory() ? archivos(ruta) : /\.(ts|tsx)$/u.test(nombre) ? [ruta] : []
    })
  }
  const fuentes = archivos('src').filter((ruta) => !ruta.includes(`${path.sep}types${path.sep}`))

  test('ningún módulo llama a from(\'inscripciones\')', () => {
    const infractores = fuentes.filter((ruta) =>
      /\.from\(\s*['"`]inscripciones['"`]\s*\)/u.test(readFileSync(ruta, 'utf8')))
    expect(infractores).toEqual([])
  })

  test('ninguna operación de borrado físico sobre tablas de inscripciones', () => {
    const infractores = fuentes.filter((ruta) =>
      /\.from\(\s*['"`]inscripciones[a-z_]*['"`]\s*\)[\s\S]{0,80}\.delete\(/u.test(readFileSync(ruta, 'utf8')))
    expect(infractores).toEqual([])
  })
})
