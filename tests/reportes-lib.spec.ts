import { expect, test } from '@playwright/test'
import {
  BOM_UTF8,
  FILTROS_VACIOS,
  IDS_REPORTE,
  LISTA_REPORTES,
  REPORTES,
  SALTO_CSV,
  SEPARADOR_CSV,
  argumentosRpc,
  celdaCsv,
  celdasDeFila,
  columnasDe,
  construirCsv,
  describirFiltros,
  fecha,
  filaCsv,
  hora,
  leerFiltros,
  nombreArchivoCsv,
  nombreDia,
  parametrosDeUrl,
  parametrosDesdeUrl,
  tituloDeFila,
  type FilaAlumnosCurso,
  type FilaAlumnosHorario,
  type FilaDocentesNivel,
  type FilaReporte,
} from '../src/lib/reportes'
import { paginasVisibles } from '../src/app/dashboard/reportes/_components/Paginacion'

/**
 * Contrato de la librería de reportes (EPT-63), sin navegador ni base de datos:
 * exportación CSV (escape y neutralización de fórmulas), lectura y validación de
 * filtros, argumentos de las funciones de PostgreSQL, columnas y privacidad.
 */

const UUID = '3f2b8d3e-7c1a-4b5e-9d2a-1a2b3c4d5e6f'

const ALUMNO: FilaAlumnosCurso = {
  id: '11111111-1111-4111-8111-111111111111',
  total_filas: 1,
  alumno_apellido: 'García',
  alumno_nombre: 'Sofía',
  legajo_nro: 'LEG-0001',
  alumno_estado: 'ACTIVO',
  nivel_id: 2,
  nivel_nombre: 'PRIMARIO',
  curso_id: UUID,
  curso_denominacion: '3° Grado',
  curso_division: 'A',
  fecha_inicio: '2026-03-01T11:00:00+00:00',
  fecha_cierre: null,
  motivo_cierre: null,
  vigente: true,
}

test.describe('celdaCsv: escape', () => {
  test('un texto común queda igual', () => {
    expect(celdaCsv('Lengua')).toBe('Lengua')
    expect(celdaCsv('Año 2026')).toBe('Año 2026')
  })

  test('el separador obliga a entrecomillar', () => {
    expect(celdaCsv('Lunes; 08:00')).toBe('"Lunes; 08:00"')
  })

  test('las comillas se duplican', () => {
    expect(celdaCsv('El "grande"')).toBe('"El ""grande"""')
  })

  test('los saltos de línea quedan dentro de la celda', () => {
    expect(celdaCsv('línea 1\nlínea 2')).toBe('"línea 1\nlínea 2"')
    expect(celdaCsv('línea 1\r\nlínea 2')).toBe('"línea 1\r\nlínea 2"')
  })

  test('la coma NO es separador (se usa punto y coma) y no obliga a entrecomillar', () => {
    expect(SEPARADOR_CSV).toBe(';')
    expect(celdaCsv('García, Sofía')).toBe('García, Sofía')
  })

  test('una fila une las celdas con el separador', () => {
    expect(filaCsv(['a', 'b;c', 'd'])).toBe('a;"b;c";d')
  })
})

test.describe('celdaCsv: neutralización de fórmulas de planilla', () => {
  for (const peligroso of ['=1+1', '+SUMA(A1)', '-2+3', '@SUM(A1)', '=cmd|" /C calc"!A0', '\t=1+1', '\r=1']) {
    test(`antepone un apóstrofo a ${JSON.stringify(peligroso)}`, () => {
      const celda = celdaCsv(peligroso)
      const sinComillas = celda.startsWith('"') ? celda.slice(1, -1).replace(/""/g, '"') : celda
      expect(sinComillas.startsWith("'")).toBe(true)
      expect(sinComillas.slice(1)).toBe(peligroso)
    })
  }

  test('también con espacios antes del signo', () => {
    expect(celdaCsv('  =1+1')).toBe("'  =1+1")
  })

  test('un texto que solo CONTIENE el signo no se toca', () => {
    expect(celdaCsv('a=b')).toBe('a=b')
    expect(celdaCsv('Ana-María')).toBe('Ana-María')
    expect(celdaCsv('correo@escuela')).toBe('correo@escuela')
  })

  test('una fórmula con separador queda neutralizada Y entrecomillada', () => {
    expect(celdaCsv('=A1;B1')).toBe(`"'=A1;B1"`)
  })
})

test.describe('construirCsv', () => {
  test('empieza con BOM, tiene encabezados en español y termina cada línea con CRLF', () => {
    const csv = construirCsv('alumnos-por-curso', [ALUMNO])
    expect(csv.startsWith(BOM_UTF8)).toBe(true)
    const lineas = csv.slice(1).split(SALTO_CSV)
    expect(lineas[0]).toBe('Apellido;Nombre;Legajo;Nivel;Curso;Situación;Desde;Hasta;Motivo de cierre')
    expect(lineas[1]).toBe('García;Sofía;LEG-0001;PRIMARIO;3° Grado A;Vigente;01/03/2026;—;—')
    expect(lineas[2]).toBe('')
    expect(csv.endsWith(SALTO_CSV)).toBe(true)
  })

  test('sin filas trae solo los encabezados', () => {
    const csv = construirCsv('docentes-por-nivel', [])
    expect(csv.slice(1).split(SALTO_CSV).filter(Boolean)).toHaveLength(1)
  })

  test('un nombre con fórmula, comillas y punto y coma sale a salvo', () => {
    const csv = construirCsv('alumnos-por-curso', [
      { ...ALUMNO, alumno_apellido: '=HYPERLINK("http://x";"y")', alumno_nombre: 'Ana;María' },
    ])
    const linea = csv.slice(1).split(SALTO_CSV)[1]
    expect(linea.startsWith(`"'=HYPERLINK(""http://x"";""y"")";"Ana;María";`)).toBe(true)
  })

  test('conserva todas las filas y su orden', () => {
    const filas = Array.from({ length: 2500 }, (_, i) => ({ ...ALUMNO, id: `id-${i}`, alumno_apellido: `Apellido ${i}` }))
    const lineas = construirCsv('alumnos-por-curso', filas).slice(1).split(SALTO_CSV)
    expect(lineas).toHaveLength(2502)
    expect(lineas[1].startsWith('Apellido 0;')).toBe(true)
    expect(lineas[2500].startsWith('Apellido 2499;')).toBe(true)
  })

  test('el nombre del archivo lleva el reporte y la fecha local', () => {
    expect(nombreArchivoCsv('alumnos-por-curso', new Date('2026-09-29T02:00:00Z'))).toBe(
      'reporte-alumnos-por-curso-2026-09-28.csv'
    )
    expect(nombreArchivoCsv('docentes-por-nivel', new Date('2026-09-29T12:00:00Z'))).toBe(
      'reporte-docentes-por-nivel-2026-09-29.csv'
    )
  })
})

test.describe('privacidad de las columnas', () => {
  const PROHIBIDO = /confirm|dni|documento|tel[eé]fono|direcci[oó]n|domicilio|nacimiento|correo|email|user_id/i

  for (const id of IDS_REPORTE) {
    test(`${id}: ningún encabezado, clave ni título alude a datos no aprobados`, () => {
      for (const columna of columnasDe(id)) {
        expect(columna.encabezado).not.toMatch(PROHIBIDO)
        expect(columna.clave).not.toMatch(PROHIBIDO)
      }
      const definicion = REPORTES[id]
      expect(`${definicion.titulo} ${definicion.descripcion} ${definicion.grano} ${definicion.nota ?? ''}`).not.toMatch(
        /confirmad[ao] por|confirmador/i
      )
    })
  }

  test('una fila con campos extra del confirmador no los muestra: solo salen las columnas declaradas', () => {
    const fila = {
      ...ALUMNO,
      confirmada_por: 'Directora Uno',
      confirmada_por_nombre: 'Ana',
      confirmada_por_apellido: 'Directora',
      confirmada_en: '2026-09-01T00:00:00Z',
    } as unknown as FilaAlumnosCurso
    const texto = [...celdasDeFila('alumnos-por-curso', fila), construirCsv('alumnos-por-curso', [fila])].join('|')
    expect(texto).not.toMatch(/Directora|confirmad/i)
  })
})

test.describe('columnas y formato', () => {
  test('cada reporte tiene columnas y ninguna clave repetida', () => {
    for (const id of IDS_REPORTE) {
      const claves = columnasDe(id).map((c) => c.clave)
      expect(claves.length).toBeGreaterThan(4)
      expect(new Set(claves).size).toBe(claves.length)
    }
  })

  test('las fechas y horas se ven igual en cualquier zona: fecha de Buenos Aires, hora recortada', () => {
    expect(fecha('2026-09-29T02:30:00Z')).toBe('28/09/2026')
    expect(fecha(null)).toBe('—')
    expect(fecha('no es una fecha')).toBe('—')
    expect(hora('08:00:00')).toBe('08:00')
    expect(hora(null)).toBe('—')
    expect(nombreDia(1)).toBe('Lunes')
    expect(nombreDia(7)).toBe('Domingo')
    expect(nombreDia(9)).toBe('—')
  })

  test('el horario identifica el origen y usa curso o grupo según corresponda', () => {
    const base: FilaAlumnosHorario = {
      id: 'A:1:2',
      total_filas: 2,
      origen: 'ACADEMICO',
      alumno_apellido: 'Pérez',
      alumno_nombre: 'Juan',
      legajo_nro: null,
      dia_semana: 3,
      hora_inicio: '08:00:00',
      hora_fin: '09:00:00',
      actividad_nombre: 'Matemática',
      curso_denominacion: '1° Año',
      curso_division: 'B',
      grupo_nombre: null,
      nivel_id: 3,
      nivel_nombre: 'SECUNDARIO',
      responsable_apellido: null,
      responsable_nombre: null,
    }
    expect(celdasDeFila('alumnos-por-horario', base)).toEqual([
      'Miércoles', '08:00', '09:00', 'Pérez', 'Juan', '—', 'Académico', 'Matemática', '1° Año B', 'SECUNDARIO', 'Sin responsable',
    ])
    expect(
      celdasDeFila('alumnos-por-horario', {
        ...base,
        origen: 'DEPORTIVO',
        actividad_nombre: 'Fútbol',
        curso_denominacion: null,
        curso_division: null,
        grupo_nombre: 'Fútbol A',
        responsable_apellido: 'Zorrilla',
        responsable_nombre: 'Ana',
      })
    ).toEqual(['Miércoles', '08:00', '09:00', 'Pérez', 'Juan', '—', 'Deportivo', 'Fútbol', 'Fútbol A', 'SECUNDARIO', 'Zorrilla, Ana'])
  })

  test('docentes: el estado y el origen se leen en español', () => {
    const fila: FilaDocentesNivel = {
      id: 'D:1',
      total_filas: 1,
      origen: 'DEPORTIVO',
      docente_apellido: 'Yáñez',
      docente_nombre: 'Beto',
      docente_estado: 'INACTIVO',
      especialidad: null,
      nivel_id: 1,
      nivel_nombre: 'INICIAL',
      actividad_nombre: 'Natación',
      curso_denominacion: null,
      curso_division: null,
      grupo_nombre: 'Natación A',
    }
    expect(celdasDeFila('docentes-por-nivel', fila)).toEqual([
      'INICIAL', 'Yáñez', 'Beto', '—', 'Inactivo', 'Deportivo', 'Natación', 'Natación A',
    ])
  })

  test('el título de la tarjeta es siempre la persona', () => {
    expect(tituloDeFila('alumnos-por-curso', ALUMNO)).toBe('García, Sofía')
  })

  test('las páginas visibles incluyen la primera, la última y las cercanas', () => {
    expect(paginasVisibles(1, 1)).toEqual([1])
    expect(paginasVisibles(1, 3)).toEqual([1, 2, 3])
    expect(paginasVisibles(5, 20)).toEqual([1, 'salto', 4, 5, 6, 'salto', 20])
    expect(paginasVisibles(2, 20)).toEqual([1, 2, 3, 'salto', 20])
    expect(paginasVisibles(20, 20)).toEqual([1, 'salto', 19, 20])
  })
})

test.describe('leerFiltros', () => {
  const curso = REPORTES['alumnos-por-curso']

  test('sin parámetros: sin filtros, página 1 y 50 filas', () => {
    const r = leerFiltros(curso, {})
    expect(r).toEqual({ ok: true, filtros: FILTROS_VACIOS, pagina: 1, tamano: 50 })
  })

  test('los valores vacíos equivalen a «sin filtro»', () => {
    const r = leerFiltros(curso, { nivel: '', curso: '', q: '  ', historial: '' })
    expect(r).toEqual({ ok: true, filtros: FILTROS_VACIOS, pagina: 1, tamano: 50 })
  })

  test('lee todos los filtros combinados', () => {
    const r = leerFiltros(curso, {
      q: ' García ',
      nivel: '2',
      curso: UUID.toUpperCase(),
      materia: '7',
      deporte: UUID,
      recorrido: UUID,
      horario: UUID,
      responsable: UUID,
      historial: '1',
      pagina: '3',
      tamano: '100',
    })
    expect(r).toEqual({
      ok: true,
      filtros: {
        q: 'García',
        nivel: 2,
        curso: UUID,
        materia: 7,
        deporte: UUID,
        recorrido: UUID,
        horario: UUID,
        responsable: UUID,
        historial: true,
      },
      pagina: 3,
      tamano: 100,
    })
  })

  test('devuelve TODOS los errores, no solo el primero', () => {
    const r = leerFiltros(curso, { nivel: 'x', curso: 'no-uuid', materia: '0', pagina: '-1', tamano: '7' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errores.map((e) => e.campo).sort()).toEqual(['curso', 'materia', 'nivel', 'pagina', 'tamano'])
  })

  test('rechaza un filtro que el reporte no admite en lugar de ignorarlo', () => {
    for (const id of ['alumnos-por-materia', 'alumnos-por-horario', 'docentes-por-nivel'] as const) {
      const r = leerFiltros(REPORTES[id], { historial: '1' })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errores[0].mensaje).toContain('no aplica')
    }
    expect(leerFiltros(REPORTES['docentes-por-nivel'], { recorrido: UUID }).ok).toBe(false)
    expect(leerFiltros(REPORTES['alumnos-por-curso'], { origen: 'ACADEMICO' }).ok).toBe(false)
  })

  test('rechaza un parámetro desconocido y uno repetido', () => {
    expect(leerFiltros(curso, { inventado: '1' }).ok).toBe(false)
    expect(leerFiltros(curso, { nivel: ['1', '2'] }).ok).toBe(false)
  })

  test('rechaza valores fuera de contrato', () => {
    expect(leerFiltros(curso, { historial: 'yes' }).ok).toBe(false)
    expect(leerFiltros(REPORTES['alumnos-por-horario'], { origen: 'OTRO' }).ok).toBe(false)
    expect(leerFiltros(curso, { q: 'a'.repeat(101) }).ok).toBe(false)
    expect(leerFiltros(curso, { q: 'a'.repeat(100) }).ok).toBe(true)
    expect(leerFiltros(curso, { nivel: '1; DROP TABLE perfiles' }).ok).toBe(false)
    expect(leerFiltros(curso, { curso: `${UUID}' OR '1'='1` }).ok).toBe(false)
  })

  test('un enlace se reconstruye idéntico a partir de los filtros', () => {
    const filtros = { q: 'a b', nivel: 2, curso: UUID, historial: true }
    const parametros = parametrosDeUrl(filtros, { pagina: 2, tamano: 25 })
    const r = leerFiltros(curso, parametrosDesdeUrl(parametros))
    expect(r).toEqual({ ok: true, filtros, pagina: 2, tamano: 25 })
  })

  test('parametrosDesdeUrl conserva los repetidos como arreglo', () => {
    expect(parametrosDesdeUrl(new URLSearchParams('nivel=1&nivel=2&q=x'))).toEqual({ nivel: ['1', '2'], q: 'x' })
  })
})

test.describe('argumentosRpc', () => {
  test('sin filtros solo envía la paginación', () => {
    expect(argumentosRpc(REPORTES['alumnos-por-curso'], FILTROS_VACIOS, 50, 100)).toEqual({
      p_limite: 50,
      p_desplazamiento: 100,
    })
  })

  test('traduce cada filtro a su parámetro de PostgreSQL', () => {
    expect(
      argumentosRpc(
        REPORTES['alumnos-por-horario'],
        { q: 'x', nivel: 1, curso: UUID, materia: 2, deporte: UUID, recorrido: UUID, horario: UUID, responsable: UUID, origen: 'DEPORTIVO', historial: true },
        1000,
        0
      )
    ).toEqual({
      p_limite: 1000,
      p_desplazamiento: 0,
      p_busqueda: 'x',
      p_nivel_id: 1,
      p_curso_id: UUID,
      p_materia_id: 2,
      p_deporte_id: UUID,
      p_servicio_id: UUID,
      p_horario_id: UUID,
      p_profesor_id: UUID,
      p_origen: 'DEPORTIVO',
    })
  })

  test('el historial solo viaja a los reportes que lo registran', () => {
    const con = { ...FILTROS_VACIOS, historial: true }
    expect(argumentosRpc(REPORTES['alumnos-por-curso'], con, 10, 0)).toHaveProperty('p_incluir_historial', true)
    expect(argumentosRpc(REPORTES['alumnos-por-deporte'], con, 10, 0)).toHaveProperty('p_incluir_historial', true)
    expect(argumentosRpc(REPORTES['alumnos-por-recorrido'], con, 10, 0)).toHaveProperty('p_incluir_historial', true)
    expect(argumentosRpc(REPORTES['alumnos-por-materia'], con, 10, 0)).not.toHaveProperty('p_incluir_historial')
    expect(argumentosRpc(REPORTES['alumnos-por-horario'], con, 10, 0)).not.toHaveProperty('p_incluir_historial')
    expect(argumentosRpc(REPORTES['docentes-por-nivel'], con, 10, 0)).not.toHaveProperty('p_incluir_historial')
  })

  test('el reporte de docentes no envía el recorrido (su función no lo recibe)', () => {
    const args = argumentosRpc(REPORTES['docentes-por-nivel'], { ...FILTROS_VACIOS, recorrido: UUID }, 10, 0)
    expect(args).not.toHaveProperty('p_servicio_id')
  })
})

test.describe('definiciones', () => {
  test('hay seis reportes y cada uno declara su grano y sus filtros', () => {
    expect(LISTA_REPORTES).toHaveLength(6)
    for (const reporte of LISTA_REPORTES) {
      expect(reporte.grano.length).toBeGreaterThan(20)
      expect(reporte.filtros).toContain('q')
      expect(reporte.filtros).toContain('nivel')
    }
  })

  test('el historial se ofrece solo donde el esquema lo registra, y donde no, se explica por qué', () => {
    expect(LISTA_REPORTES.filter((r) => r.historial).map((r) => r.id)).toEqual([
      'alumnos-por-curso',
      'alumnos-por-deporte',
      'alumnos-por-recorrido',
    ])
    for (const reporte of LISTA_REPORTES.filter((r) => !r.historial)) {
      expect(reporte.filtros).not.toContain('historial')
      expect(reporte.sinHistorial).toMatch(/no registra/)
    }
  })

  test('el responsable es el profesor: hay un filtro de profesor y ninguno de padre o tutor', () => {
    for (const reporte of LISTA_REPORTES) {
      expect(reporte.filtros).not.toContain('tutor' as never)
      expect(`${reporte.titulo} ${reporte.descripcion} ${reporte.grano}`).not.toMatch(/tutor|padre/i)
    }
  })

  test('describirFiltros usa los nombres del catálogo y avisa lo que no conoce', () => {
    const catalogos = {
      niveles: [{ id: 2, nombre: 'PRIMARIO' }],
      cursos: [], materias: [], deportes: [], recorridos: [], horarios: [], profesores: [],
    }
    const lista = describirFiltros(REPORTES['alumnos-por-curso'], { nivel: 2, materia: 99, historial: true }, catalogos)
    expect(lista).toContainEqual({ etiqueta: 'Nivel', valor: 'PRIMARIO' })
    expect(lista).toContainEqual({ etiqueta: 'Materia', valor: 'desconocido' })
    expect(lista).toContainEqual({ etiqueta: 'Historial', valor: 'Incluido' })
    expect(describirFiltros(REPORTES['docentes-por-nivel'], FILTROS_VACIOS, null)).toContainEqual({
      etiqueta: 'Historial',
      valor: 'No disponible',
    })
  })

  test('las filas de cualquier reporte se pueden formatear', () => {
    const filas: [keyof typeof REPORTES, FilaReporte][] = [['alumnos-por-curso', ALUMNO]]
    for (const [id, fila] of filas) expect(celdasDeFila(id, fila).length).toBe(columnasDe(id).length)
  })
})
