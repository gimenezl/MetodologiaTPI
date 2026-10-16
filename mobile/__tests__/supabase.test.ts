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

  it('permite HTTP solo con la opt-in de integración y el host/puerto local exacto de Android', () => {
    expect(leerEntorno({ ...VALIDAS, EXPO_PUBLIC_SUPABASE_URL: 'http://10.0.2.2:54321' }, {
      authIntegracionLocal: true, plataforma: 'android',
    })).toMatchObject({ ok: true })
    expect(leerEntorno({ ...VALIDAS, EXPO_PUBLIC_SUPABASE_URL: 'http://10.0.2.2:54321' }).ok).toBe(false)
    for (const url of ['http://localhost:54321', 'http://10.0.2.2:54322', 'http://10.0.2.2:54321/rest/v1', 'http://user@10.0.2.2:54321']) {
      expect(leerEntorno({ ...VALIDAS, EXPO_PUBLIC_SUPABASE_URL: url }, {
        authIntegracionLocal: true, plataforma: 'android',
      }).ok).toBe(false)
    }
  })

  it('permite únicamente loopback en iOS cuando la opt-in está activa', () => {
    expect(leerEntorno({ ...VALIDAS, EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }, {
      authIntegracionLocal: true, plataforma: 'ios',
    })).toMatchObject({ ok: true })
    expect(leerEntorno({ ...VALIDAS, EXPO_PUBLIC_SUPABASE_URL: 'http://10.0.2.2:54321' }, {
      authIntegracionLocal: true, plataforma: 'ios',
    }).ok).toBe(false)
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

describe('servidor web local de integración (EPT-109)', () => {
  const LOCAL = {
    ...VALIDAS,
    EXPO_PUBLIC_SUPABASE_URL: 'http://10.0.2.2:54321',
    EXPO_PUBLIC_API_BASE_URL: 'http://10.0.2.2:3000',
  }

  it('solo con la opt-in de integración y el host y puerto exactos', () => {
    expect(leerEntorno(LOCAL, { authIntegracionLocal: true, plataforma: 'android' })).toMatchObject({ ok: true })
    expect(leerEntorno(LOCAL).ok).toBe(false)
    for (const url of ['http://10.0.2.2:3001', 'http://localhost:3000', 'http://10.0.2.2:3000/api', 'http://u@10.0.2.2:3000']) {
      expect(leerEntorno({ ...LOCAL, EXPO_PUBLIC_API_BASE_URL: url }, {
        authIntegracionLocal: true, plataforma: 'android',
      }).ok).toBe(false)
    }
  })

  it('un servidor remoto sigue exigiendo https aun con la opt-in', () => {
    expect(leerEntorno({ ...LOCAL, EXPO_PUBLIC_API_BASE_URL: 'http://app.example.org' }, {
      authIntegracionLocal: true, plataforma: 'android',
    }).ok).toBe(false)
  })
})
