import { leerEntorno, esClavePrivada } from '@/configuracion/entorno'

const jwt = (carga: object) =>
  `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(carga)).toString('base64url')}.firma-de-prueba`

const VALIDAS = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://proyecto.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: 'anon' }),
  EXPO_PUBLIC_API_BASE_URL: 'https://app.educarparatransformar.example',
}

describe('configuración pública', () => {
  it('acepta URL https y clave anon', () => {
    expect(leerEntorno(VALIDAS)).toMatchObject({ ok: true })
  })

  it('acepta una clave publicable que no es JWT', () => {
    expect(leerEntorno({ ...VALIDAS, EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_abcdefghij' })).toMatchObject({ ok: true })
  })

  it('rechaza una clave con rol service_role', () => {
    const r = leerEntorno({ ...VALIDAS, EXPO_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: 'service_role' }) })
    expect(r.ok).toBe(false)
    expect(esClavePrivada(jwt({ role: 'service_role' }))).toBe(true)
  })

  it('rechaza una clave secreta nueva y un JWT sin rol', () => {
    expect(esClavePrivada('sb_secret_abcdefghijk')).toBe(true)
    expect(esClavePrivada(jwt({ sub: '1' }))).toBe(true)
  })

  it.each([
    ['URL http', { EXPO_PUBLIC_SUPABASE_URL: 'http://proyecto.supabase.co' }],
    ['URL con credenciales', { EXPO_PUBLIC_API_BASE_URL: 'https://u:p@app.example' }],
    ['URL ausente', { EXPO_PUBLIC_SUPABASE_URL: '' }],
    ['clave ausente', { EXPO_PUBLIC_SUPABASE_ANON_KEY: '' }],
  ])('rechaza %s', (_n, cambio) => {
    expect(leerEntorno({ ...VALIDAS, ...cambio }).ok).toBe(false)
  })

  it('los motivos no repiten el valor de la clave', () => {
    const clave = jwt({ role: 'service_role' })
    const r = leerEntorno({ ...VALIDAS, EXPO_PUBLIC_SUPABASE_ANON_KEY: clave })
    expect(JSON.stringify(r)).not.toContain(clave)
  })
})
