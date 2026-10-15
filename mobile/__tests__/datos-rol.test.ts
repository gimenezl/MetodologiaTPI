import { cargarDatosRol } from '@/contenedores/acceso/datos-rol'
import type { ClienteEPT } from '@/servicios/supabase'

function clienteDePrueba(respuestas: Record<string, unknown>) {
  type ConsultaPrueba = {
    select: jest.Mock<ConsultaPrueba, []>
    eq: jest.Mock<ConsultaPrueba, [string, string]>
    in: jest.Mock<ConsultaPrueba, [string, string[]]>
    maybeSingle: jest.Mock<Promise<unknown>, []>
    then: (resolve: (valor: unknown) => unknown) => Promise<unknown>
  }
  const cliente = {
    from: jest.fn((tabla: string) => {
      const consulta = {} as ConsultaPrueba
      consulta.select = jest.fn(() => consulta)
      consulta.eq = jest.fn((_campo: string, _valor: string) => consulta)
      consulta.in = jest.fn((_campo: string, _valores: string[]) => consulta)
      consulta.maybeSingle = jest.fn(async () => respuestas[`${tabla}:single`])
      consulta.then = resolve => Promise.resolve(respuestas[tabla]).then(resolve)
      return consulta
    }),
  }
  return { cliente: cliente as unknown as ClienteEPT }
}

describe('cargarDatosRol', () => {
  it('consulta solo vínculos del padre y limita la información a los ids devueltos por RLS', async () => {
    const hijo = { id: 'hijo-a', nombre: 'Alma', apellido: 'Ríos', legajo_nro: 'A-17', estado: 'ACTIVO', curso_denominacion: 'Primero', curso_division: 'A', nivel_nombre: 'Inicial' }
    const { cliente } = clienteDePrueba({
      'perfiles:single': { data: { id: 'padre-a' }, error: null },
      padres_hijos: { data: [{ hijo_id: 'hijo-a' }], error: null },
      alumnos_academicos: { data: [hijo], error: null },
    })

    const datos = await cargarDatosRol(cliente, 'usuario-a', 'PADRE')

    expect(datos).toEqual({ rol: 'PADRE', hijos: [hijo] })
    expect(cliente.from).toHaveBeenCalledWith('perfiles')
    expect(cliente.from).toHaveBeenCalledWith('padres_hijos')
    expect(cliente.from).toHaveBeenCalledWith('alumnos_academicos')
  })

  it('presenta el estado vacío cuando RLS devuelve cero vínculos', async () => {
    const { cliente } = clienteDePrueba({
      'perfiles:single': { data: { id: 'padre-sin-vinculo' }, error: null },
      padres_hijos: { data: [], error: null },
    })

    await expect(cargarDatosRol(cliente, 'usuario-b', 'PADRE')).resolves.toEqual({ rol: 'PADRE', hijos: [] })
    expect(cliente.from).not.toHaveBeenCalledWith('alumnos_academicos')
  })

  it('carga solo el registro académico propio del estudiante', async () => {
    const alumno = { id: 'alumno-propio', nombre: 'Mateo', apellido: 'Luna', legajo_nro: null, estado: 'ACTIVO', curso_denominacion: null, curso_division: null, nivel_nombre: null }
    const { cliente } = clienteDePrueba({
      'perfiles:single': { data: { id: 'alumno-propio' }, error: null },
      'alumnos_academicos:single': { data: alumno, error: null },
    })

    await expect(cargarDatosRol(cliente, 'usuario-c', 'ESTUDIANTE')).resolves.toEqual({ rol: 'ESTUDIANTE', alumno })
  })

  it('rechaza cualquier rol que no tenga una pantalla móvil autorizada', async () => {
    const { cliente } = clienteDePrueba({})
    await expect(cargarDatosRol(cliente, 'usuario-d', 'DOCENTE')).rejects.toThrow('El rol no tiene una vista móvil disponible.')
    expect(cliente.from).not.toHaveBeenCalled()
  })
})
