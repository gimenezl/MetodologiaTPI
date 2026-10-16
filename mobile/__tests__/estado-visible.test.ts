import { estadoVisible, type EstadoAutenticacion } from '@/servicios/autenticacion'

const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const autenticada: Extract<EstadoAutenticacion, { tipo: 'autenticada' }> = { tipo: 'autenticada', usuarioId: U, rol: 'PADRE' }

describe('estadoVisible', () => {
  it('conserva la vista del mismo usuario mientras se revalida (refresco de token)', () => {
    expect(estadoVisible({ tipo: 'revalidando', usuarioId: U }, autenticada)).toBe(autenticada)
  })

  it('no conserva la vista de otro usuario ni sin una sesión previa', () => {
    const otro = { tipo: 'revalidando', usuarioId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } as const
    expect(estadoVisible(otro, autenticada)).toBe(otro)
    const sinPrevia = { tipo: 'revalidando', usuarioId: U } as const
    expect(estadoVisible(sinPrevia, null)).toBe(sinPrevia)
  })

  it('cualquier otro resultado reemplaza la vista de inmediato', () => {
    for (const real of [
      { tipo: 'bloqueada' }, { tipo: 'sin_perfil' }, { tipo: 'rol_no_admitido' }, { tipo: 'sin_sesion' }, { tipo: 'cargando' },
      { tipo: 'error_conexion', usuarioId: U, mensaje: 'x' },
    ] as const) {
      expect(estadoVisible(real, autenticada)).toBe(real)
    }
  })
})
