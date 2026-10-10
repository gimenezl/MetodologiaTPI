import { ErrorTransporte, crearTransporteHttp, resolverRuta, validarBaseUrl } from '@/servicios/transporte-http'

const BASE = 'https://api.educarparatransformar.example'

function respuesta(cuerpo: unknown, init: { status?: number; url?: string; tipo?: string } = {}): Response {
  const status = init.status ?? 200
  const texto = cuerpo === undefined ? '' : JSON.stringify(cuerpo)
  const r = new Response(status === 204 ? null : texto, {
    status,
    headers: { 'content-type': init.tipo ?? 'application/json' },
  })
  if (init.url) Object.defineProperty(r, 'url', { value: init.url })
  return r
}

function crear(fetchImpl: jest.Mock, token: string | null = 'TOKEN-DE-PRUEBA', extra: Partial<Parameters<typeof crearTransporteHttp>[0]> = {}) {
  return crearTransporteHttp({ baseUrl: BASE, obtenerToken: async () => token, fetchImpl: fetchImpl as unknown as typeof fetch, ...extra })
}

describe('validación de la URL base', () => {
  it.each([
    ['http://api.example.org', 'http sin ser loopback'],
    ['ftp://api.example.org', 'protocolo no admitido'],
    ['https://usuario:clave@api.example.org', 'credenciales en la URL'],
    ['https://api.example.org?x=1', 'consulta en la base'],
    ['https://api.example.org#frag', 'fragmento en la base'],
    ['no es una url', 'texto libre'],
  ])('rechaza %s (%s)', base => {
    expect(() => validarBaseUrl(base)).toThrow(ErrorTransporte)
  })

  it('permite http solo hacia loopback y únicamente si se habilita', () => {
    expect(() => validarBaseUrl('http://10.0.2.2:3000')).toThrow(ErrorTransporte)
    expect(validarBaseUrl('http://10.0.2.2:3000', true).hostname).toBe('10.0.2.2')
    expect(() => validarBaseUrl('http://api.example.org', true)).toThrow(ErrorTransporte)
  })
})

describe('resolución de rutas', () => {
  const base = new URL(BASE)
  it.each(['//evil.example/x', 'https://evil.example/x', '/../x', '/a/%2e%2e/b', '/a\\b', 'sin-barra', '/a\n'])(
    'rechaza %j',
    ruta => {
      expect(() => resolverRuta(base, ruta)).toThrow(ErrorTransporte)
    }
  )

  it('conserva el origen y agrega la consulta codificada', () => {
    const url = resolverRuta(base, '/api/facturas/1/pdf', { periodo: '2026-10', a: true })
    expect(url.origin).toBe(BASE)
    expect(url.search).toBe('?periodo=2026-10&a=true')
  })
})

describe('solicitudes', () => {
  it('adjunta Bearer, no envía cookies y devuelve el JSON', async () => {
    const f = jest.fn().mockResolvedValue(respuesta({ ok: true }))
    const r = await crear(f).solicitar<{ ok: boolean }>('/api/ping')
    expect(r.datos).toEqual({ ok: true })
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/api/ping`)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN-DE-PRUEBA')
    expect(init.credentials).toBe('omit')
    expect(init.redirect).toBe('manual')
  })

  it('no envía la solicitud si no hay sesión', async () => {
    const f = jest.fn()
    await expect(crear(f, null).solicitar('/api/ping')).rejects.toMatchObject({ tipo: 'SIN_SESION' })
    expect(f).not.toHaveBeenCalled()
  })

  it('una solicitud anónima no adjunta Bearer', async () => {
    const f = jest.fn().mockResolvedValue(respuesta({}))
    await crear(f, 'TOKEN').solicitar('/api/publico', { anonima: true })
    const init = f.mock.calls[0]![1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('no envía a un origen distinto de la base', async () => {
    const f = jest.fn()
    await expect(crear(f).solicitar('//evil.example/robar')).rejects.toMatchObject({ tipo: 'RUTA_INVALIDA' })
    expect(f).not.toHaveBeenCalled()
  })

  it('rechaza una redirección (3xx) sin seguirla', async () => {
    const f = jest.fn().mockResolvedValue(respuesta(undefined, { status: 302 }))
    await expect(crear(f).solicitar('/api/x')).rejects.toMatchObject({ tipo: 'REDIRECCION_EXTERNA', estado: 302 })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('rechaza una respuesta cuyo destino final es otro origen', async () => {
    const f = jest.fn().mockResolvedValue(respuesta({ ok: 1 }, { url: 'https://evil.example/x' }))
    await expect(crear(f).solicitar('/api/x')).rejects.toMatchObject({ tipo: 'REDIRECCION_EXTERNA' })
  })

  it.each([
    [401, 'NO_AUTENTICADO'],
    [403, 'SIN_PERMISO'],
    [503, 'SERVICIO_NO_DISPONIBLE'],
    [418, 'ERROR_INESPERADO'],
  ])('traduce HTTP %i al catálogo de dominio (%s) sin exponer texto ajeno', async (estado, codigo) => {
    const f = jest.fn().mockResolvedValue(respuesta({ error: 'PGRST301 relation "x" does not exist' }, { status: estado }))
    const error = await crear(f).solicitar('/api/x').catch((e: unknown) => e as ErrorTransporte)
    expect(error).toBeInstanceOf(ErrorTransporte)
    expect((error as ErrorTransporte).tipo).toBe('HTTP')
    expect((error as ErrorTransporte).dominio?.codigo).toBe(codigo)
    expect((error as ErrorTransporte).message).not.toMatch(/PGRST|relation/u)
  })

  it('usa el mensaje del servidor solo cuando trae un código del catálogo', async () => {
    const f = jest.fn().mockResolvedValue(respuesta({ codigo: 'SIN_PERMISO', error: 'No podés ver esta factura.' }, { status: 403 }))
    const error = (await crear(f).solicitar('/api/x').catch((e: unknown) => e)) as ErrorTransporte
    expect(error.message).toBe('No podés ver esta factura.')
  })

  it('una respuesta exitosa que no es JSON se informa como inválida', async () => {
    const f = jest.fn().mockResolvedValue(respuesta('<html>', { tipo: 'text/html' }))
    await expect(crear(f).solicitar('/api/x')).rejects.toMatchObject({ tipo: 'RESPUESTA_INVALIDA' })
  })

  it('un error de red se informa como falta de conexión', async () => {
    const f = jest.fn().mockRejectedValue(new TypeError('Network request failed'))
    await expect(crear(f).solicitar('/api/x')).rejects.toMatchObject({ tipo: 'SIN_CONEXION' })
  })

  it('la cancelación del llamador aborta la solicitud y la clasifica como cancelada', async () => {
    const f = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new Error('abortado'))))
    )
    const control = new AbortController()
    const promesa = crear(f as unknown as jest.Mock).solicitar('/api/x', { senal: control.signal })
    await Promise.resolve()
    await Promise.resolve()
    control.abort()
    await expect(promesa).rejects.toMatchObject({ tipo: 'CANCELADO' })
  })

  it('una señal ya cancelada no envía nada', async () => {
    const f = jest.fn()
    const control = new AbortController()
    control.abort()
    await expect(crear(f).solicitar('/api/x', { senal: control.signal })).rejects.toMatchObject({ tipo: 'CANCELADO' })
    expect(f).not.toHaveBeenCalled()
  })

  it('el tiempo agotado se clasifica y libera el temporizador', async () => {
    jest.useFakeTimers()
    try {
      const f = jest.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new Error('abortado'))))
      )
      const promesa = crear(f as unknown as jest.Mock, 'T', { timeoutMs: 1000 }).solicitar('/api/x')
      const resultado = promesa.catch((e: unknown) => e as ErrorTransporte)
      await jest.advanceTimersByTimeAsync(1001)
      expect(await resultado).toMatchObject({ tipo: 'TIEMPO_AGOTADO' })
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })

  it('no registra credenciales ni cuerpos en consola', async () => {
    const espias = (['log', 'info', 'warn', 'error', 'debug'] as const).map(m => jest.spyOn(console, m).mockImplementation(() => undefined))
    const f = jest.fn().mockResolvedValue(respuesta({ error: 'x' }, { status: 500 }))
    await crear(f, 'TOKEN-SECRETO-XYZ').solicitar('/api/x', { metodo: 'POST', cuerpo: { clave: 'valor-privado' } }).catch(() => undefined)
    for (const e of espias) {
      expect(JSON.stringify(e.mock.calls)).not.toMatch(/TOKEN-SECRETO-XYZ|valor-privado/u)
      e.mockRestore()
    }
  })

  it('los mensajes de error nunca contienen el token', async () => {
    const f = jest.fn().mockRejectedValue(new Error('fallo con TOKEN-SECRETO-XYZ'))
    const error = (await crear(f, 'TOKEN-SECRETO-XYZ').solicitar('/api/x').catch((e: unknown) => e)) as ErrorTransporte
    expect(error.message).not.toContain('TOKEN-SECRETO-XYZ')
  })
})
