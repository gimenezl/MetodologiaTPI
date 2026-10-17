import {
  DESTINO_RECUPERACION,
  actualizarContrasena,
  huellaDeEnlace,
  intercambiarCodigo,
  interpretarEnlace,
  mensajeDeActualizacion,
  normalizarCorreo,
  pedirCodigoDeVerificacion,
  solicitarRecuperacion,
  urlDesdeParametros,
} from '@/servicios/recuperacion'

const CODIGO = '34e770dd-9ff9-416c-87fa-43b31d7ef225'
const FLUJO = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

function errorAuth(nombre: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error('detalle interno que no debe llegar a la pantalla'), { name: nombre, ...extra })
}

describe('normalizarCorreo', () => {
  it('recorta espacios y acepta una dirección razonable', () => {
    expect(normalizarCorreo('  familia@escuela.edu.ar ')).toEqual({ tipo: 'ok', correo: 'familia@escuela.edu.ar' })
  })
  it.each([['', 'vacio'], ['   ', 'vacio'], ['sin-arroba', 'invalido'], ['a@b', 'invalido'], ['a b@c.de', 'invalido']])('rechaza %j', (entrada, tipo) => {
    expect(normalizarCorreo(entrada).tipo).toBe(tipo)
  })
  it('rechaza direcciones más largas que el máximo de un correo', () => {
    expect(normalizarCorreo(`${'a'.repeat(250)}@b.cd`).tipo).toBe('invalido')
  })
})

describe('solicitarRecuperacion', () => {
  it('pide el correo con el destino exacto de la aplicación y no crea cuentas', async () => {
    const auth = { resetPasswordForEmail: jest.fn(async () => ({ data: {}, error: null })), signUp: jest.fn() }
    expect(await solicitarRecuperacion(auth, 'a@b.test')).toEqual({ tipo: 'enviada' })
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('a@b.test', { redirectTo: DESTINO_RECUPERACION })
    expect(DESTINO_RECUPERACION).toBe('educarparatransformar://restablecer')
    expect(auth.signUp).not.toHaveBeenCalled()
  })

  it.each([
    ['límite de correos', errorAuth('AuthApiError', { status: 429, code: 'over_email_send_rate_limit' }), 'limite'],
    ['límite genérico', errorAuth('AuthApiError', { status: 429 }), 'limite'],
    ['sin conexión', errorAuth('AuthRetryableFetchError', { status: 0 }), 'sin_conexion'],
    ['correo inválido', errorAuth('AuthApiError', { status: 400, code: 'email_address_invalid' }), 'correo_invalido'],
    ['error del servicio', errorAuth('AuthApiError', { status: 500 }), 'error'],
  ])('traduce %s sin exponer el detalle', async (_caso, error, esperado) => {
    const auth = { resetPasswordForEmail: jest.fn(async () => ({ data: null, error })) }
    expect((await solicitarRecuperacion(auth as never, 'a@b.test')).tipo).toBe(esperado)
  })

  it('una excepción del transporte no escapa', async () => {
    const auth = { resetPasswordForEmail: jest.fn(async () => { throw errorAuth('AuthRetryableFetchError', { status: 0 }) }) }
    expect(await solicitarRecuperacion(auth as never, 'a@b.test')).toEqual({ tipo: 'sin_conexion' })
    const rara = { resetPasswordForEmail: jest.fn(async () => { throw new Error('boom') }) }
    expect(await solicitarRecuperacion(rara as never, 'a@b.test')).toEqual({ tipo: 'error' })
  })

  it('la respuesta de éxito no depende de que la cuenta exista: no hay ninguna otra rama', async () => {
    const auth = { resetPasswordForEmail: jest.fn(async () => ({ data: {}, error: null })) }
    expect(await solicitarRecuperacion(auth, 'existe@b.test')).toEqual(await solicitarRecuperacion(auth, 'no-existe@b.test'))
  })
})

describe('interpretarEnlace', () => {
  it('acepta el destino exacto con código y flujo', () => {
    const enlace = interpretarEnlace(`educarparatransformar://restablecer?code=${CODIGO}&sb_flow_id=${FLUJO}`)
    expect(enlace).toEqual({ tipo: 'codigo', codigo: CODIGO, flowId: FLUJO })
    if (enlace.tipo === 'codigo') expect(huellaDeEnlace(enlace)).toBe(`${FLUJO}:${CODIGO}`)
  })
  it.each([
    `educarparatransformar://restablecer?code=${CODIGO}`,
    `educarparatransformar://restablecer/?code=${CODIGO}`,
    `EducarParaTransformar://Restablecer?code=${CODIGO}`,
    `educarparatransformar:///restablecer?code=${CODIGO}`,
  ])('acepta la variante equivalente %s sin flujo', url => {
    expect(interpretarEnlace(url)).toEqual({ tipo: 'codigo', codigo: CODIGO, flowId: null })
  })

  it.each([
    ['otro esquema', `https://restablecer?code=${CODIGO}`],
    ['esquema parecido', `educarparatransformar2://restablecer?code=${CODIGO}`],
    ['otro destino', `educarparatransformar://otra?code=${CODIGO}`],
    ['subruta', `educarparatransformar://restablecer/extra?code=${CODIGO}`],
    ['destino con ruta ajena', `educarparatransformar://evil.example/restablecer?code=${CODIGO}`],
    ['sin esquema', 'restablecer?code=abc'],
    ['vacío', ''],
    ['demasiado largo', `educarparatransformar://restablecer?code=${'a'.repeat(5000)}`],
  ])('no admite %s', (_caso, url) => {
    expect(interpretarEnlace(url)).toEqual({ tipo: 'no_admitido' })
  })
  it('null e indefinido no se admiten', () => {
    expect(interpretarEnlace(null)).toEqual({ tipo: 'no_admitido' })
    expect(interpretarEnlace(undefined)).toEqual({ tipo: 'no_admitido' })
  })

  it.each([
    ['sin parámetros', 'educarparatransformar://restablecer'],
    ['código muy corto', 'educarparatransformar://restablecer?code=abc'],
    ['código con caracteres no admitidos', 'educarparatransformar://restablecer?code=abcdefgh%20ijkl'],
    ['código repetido (ambiguo)', `educarparatransformar://restablecer?code=${CODIGO}&code=${CODIGO}`],
    ['código en consulta y fragmento', `educarparatransformar://restablecer?code=${CODIGO}#code=${CODIGO}`],
    ['codificación rota', 'educarparatransformar://restablecer?code=%E0%A4%A'],
    ['flujo con forma inválida', `educarparatransformar://restablecer?code=${CODIGO}&sb_flow_id=../x`],
    ['flujo implícito con tokens', 'educarparatransformar://restablecer#access_token=aaa.bbb.ccc&refresh_token=zzz&type=recovery'],
    ['type=recovery sin código', 'educarparatransformar://restablecer?type=recovery'],
    ['código y error a la vez', `educarparatransformar://restablecer?code=${CODIGO}&error=access_denied`],
  ])('rechaza el enlace %s como inválido', (_caso, url) => {
    expect(interpretarEnlace(url)).toEqual({ tipo: 'rechazado', motivo: 'invalido' })
  })

  it('distingue el enlace vencido que informa Auth, en consulta o en fragmento', () => {
    const desc = 'Email+link+is+invalid+or+has+expired'
    expect(interpretarEnlace(`educarparatransformar://restablecer?error=access_denied&error_code=otp_expired&error_description=${desc}`)).toEqual({ tipo: 'rechazado', motivo: 'expirado' })
    expect(interpretarEnlace(`educarparatransformar://restablecer#error=access_denied&error_code=otp_expired&error_description=${desc}`)).toEqual({ tipo: 'rechazado', motivo: 'expirado' })
    expect(interpretarEnlace('educarparatransformar://restablecer?error=server_error&error_code=unexpected_failure')).toEqual({ tipo: 'rechazado', motivo: 'invalido' })
  })

  it('acepta el error que Auth repite idéntico en la consulta y el fragmento, pero no valores que se contradicen', () => {
    const desc = 'Email+link+is+invalid+or+has+expired'
    const doble = `educarparatransformar://restablecer?error=access_denied&error_code=otp_expired&error_description=${desc}#error=access_denied&error_code=otp_expired&error_description=${desc}&sb=`
    expect(interpretarEnlace(doble)).toEqual({ tipo: 'rechazado', motivo: 'expirado' })
    const contradictorio = 'educarparatransformar://restablecer?error=access_denied&error_code=otp_expired#error=server_error&error_code=unexpected_failure'
    expect(interpretarEnlace(contradictorio)).toEqual({ tipo: 'rechazado', motivo: 'invalido' })
  })

  it('ignora parámetros desconocidos sin dejar que alteren el resultado', () => {
    expect(interpretarEnlace(`educarparatransformar://restablecer?code=${CODIGO}&utm=1&type=recovery`)).toEqual({ tipo: 'codigo', codigo: CODIGO, flowId: null })
  })
})

describe('intercambiarCodigo', () => {
  const enlace = { tipo: 'codigo', codigo: CODIGO, flowId: FLUJO } as const
  const sesion = { user: { id: 'u-1' } }

  it('canjea el código con su flujo y confirma que es una recuperación', async () => {
    const auth = { exchangeCodeForSession: jest.fn(async () => ({ data: { session: sesion, user: sesion.user, redirectType: 'recovery' }, error: null })), signOut: jest.fn() }
    expect(await intercambiarCodigo(auth as never, enlace)).toEqual({ tipo: 'ok', usuarioId: 'u-1' })
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith(CODIGO, { flowId: FLUJO })
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it('sin flujo no envía opciones', async () => {
    const auth = { exchangeCodeForSession: jest.fn(async () => ({ data: { session: sesion, user: sesion.user, redirectType: 'recovery' }, error: null })), signOut: jest.fn() }
    await intercambiarCodigo(auth as never, { ...enlace, flowId: null })
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith(CODIGO, undefined)
  })

  it('un código válido que no es de recuperación cierra la sesión local y no habilita el cambio', async () => {
    const auth = { exchangeCodeForSession: jest.fn(async () => ({ data: { session: sesion, user: sesion.user, redirectType: null }, error: null })), signOut: jest.fn(async () => ({ error: null })) }
    expect(await intercambiarCodigo(auth as never, enlace)).toEqual({ tipo: 'no_es_recuperacion' })
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it.each([
    ['enlace vencido o usado', errorAuth('AuthApiError', { status: 400, code: 'flow_state_not_found' }), 'enlace_invalido'],
    ['código vencido', errorAuth('AuthApiError', { status: 403, code: 'otp_expired' }), 'enlace_invalido'],
    ['falta el verificador', errorAuth('AuthPKCECodeVerifierMissingError'), 'sin_verificador'],
    ['sin conexión', errorAuth('AuthRetryableFetchError', { status: 0 }), 'sin_conexion'],
    ['falla del servicio', errorAuth('AuthApiError', { status: 500 }), 'error'],
  ])('clasifica %s', async (_caso, error, esperado) => {
    const auth = { exchangeCodeForSession: jest.fn(async () => ({ data: { session: null, user: null }, error })), signOut: jest.fn() }
    expect((await intercambiarCodigo(auth as never, enlace)).tipo).toBe(esperado)
  })

  it('una respuesta sin sesión o una excepción no autorizan nada', async () => {
    const vacia = { exchangeCodeForSession: jest.fn(async () => ({ data: { session: null, user: null }, error: null })), signOut: jest.fn() }
    expect((await intercambiarCodigo(vacia as never, enlace)).tipo).toBe('error')
    const rota = { exchangeCodeForSession: jest.fn(async () => { throw new Error('x') }), signOut: jest.fn() }
    expect((await intercambiarCodigo(rota as never, enlace)).tipo).toBe('error')
  })
})

describe('actualizarContrasena', () => {
  function auth(opciones: { actual?: string | null; devuelto?: string; error?: unknown; errorUsuario?: unknown } = {}) {
    return {
      getUser: jest.fn(async () => ({
        data: { user: opciones.actual === null ? null : { id: opciones.actual ?? 'u-1' } },
        error: opciones.errorUsuario ?? null,
      })),
      updateUser: jest.fn(async () => ({ data: { user: opciones.error ? null : { id: opciones.devuelto ?? 'u-1' } }, error: opciones.error ?? null })),
    }
  }

  it('cambia solo la contraseña del usuario esperado y la envía sin recortes', async () => {
    const a = auth()
    expect(await actualizarContrasena(a as never, '  con espacios  ', { usuarioEsperado: 'u-1' })).toEqual({ tipo: 'ok' })
    expect(a.updateUser).toHaveBeenCalledWith({ password: '  con espacios  ' })
    expect(a.updateUser.mock.calls[0]).toHaveLength(1)
  })
  it('incluye el código de reautenticación cuando Auth lo pidió', async () => {
    const a = auth()
    await actualizarContrasena(a as never, 'nueva', { usuarioEsperado: 'u-1', nonce: '123456' })
    expect(a.updateUser).toHaveBeenCalledWith({ password: 'nueva', nonce: '123456' })
  })
  it('no escribe si la sesión ya no es del usuario esperado', async () => {
    const a = auth({ actual: 'u-2' })
    expect(await actualizarContrasena(a as never, 'nueva', { usuarioEsperado: 'u-1' })).toEqual({ tipo: 'usuario_distinto' })
    expect(a.updateUser).not.toHaveBeenCalled()
  })
  it('no da por bueno un resultado de otro usuario', async () => {
    const a = auth({ devuelto: 'u-2' })
    expect(await actualizarContrasena(a as never, 'nueva', { usuarioEsperado: 'u-1' })).toEqual({ tipo: 'usuario_distinto' })
  })
  it('sin usuario verificado no hay cambio', async () => {
    const a = auth({ actual: null })
    expect(await actualizarContrasena(a as never, 'nueva', { usuarioEsperado: 'u-1' })).toEqual({ tipo: 'sesion_expirada' })
    expect(a.updateUser).not.toHaveBeenCalled()
  })
  it.each([
    ['requiere reautenticación', errorAuth('AuthApiError', { status: 400, code: 'reauthentication_needed' }), 'reautenticar'],
    ['código inválido', errorAuth('AuthApiError', { status: 422, code: 'reauthentication_not_valid' }), 'codigo_invalido'],
    ['misma contraseña', errorAuth('AuthApiError', { status: 422, code: 'same_password' }), 'misma_contrasena'],
    ['sesión ausente', errorAuth('AuthSessionMissingError'), 'sesion_expirada'],
    ['sesión inexistente', errorAuth('AuthApiError', { status: 403, code: 'session_not_found' }), 'sesion_expirada'],
    ['JWT inválido', errorAuth('AuthApiError', { status: 401 }), 'sesion_expirada'],
    ['validación del servicio', errorAuth('AuthApiError', { status: 422, code: 'validation_failed' }), 'rechazada'],
    ['sin conexión', errorAuth('AuthRetryableFetchError', { status: 0 }), 'sin_conexion'],
    ['falla del servicio', errorAuth('AuthApiError', { status: 500 }), 'error'],
  ])('clasifica %s', async (_caso, error, esperado) => {
    expect((await actualizarContrasena(auth({ error }) as never, 'nueva', { usuarioEsperado: 'u-1' })).tipo).toBe(esperado)
  })
  it('conserva los motivos de una contraseña débil', async () => {
    const error = errorAuth('AuthWeakPasswordError', { status: 422, code: 'weak_password', reasons: ['length', 'characters'] })
    const resultado = await actualizarContrasena(auth({ error }) as never, 'x', { usuarioEsperado: 'u-1' })
    expect(resultado).toEqual({ tipo: 'debil', motivos: ['length', 'characters'] })
    if (resultado.tipo === 'debil') expect(mensajeDeActualizacion(resultado)).toBe('La contraseña no cumple los requisitos de seguridad. Debe tener más caracteres, combinar letras, números o símbolos.')
  })
  it('una excepción inesperada no escapa ni filtra su texto', async () => {
    const a = { getUser: jest.fn(async () => { throw new Error('secreto-interno') }), updateUser: jest.fn() }
    const r = await actualizarContrasena(a as never, 'nueva', { usuarioEsperado: 'u-1' })
    expect(r).toEqual({ tipo: 'error' })
    expect(JSON.stringify(r)).not.toContain('secreto')
  })
})

describe('pedirCodigoDeVerificacion y mensajes', () => {
  it('traduce los resultados de reauthenticate', async () => {
    expect(await pedirCodigoDeVerificacion({ reauthenticate: jest.fn(async () => ({ data: {}, error: null })) } as never)).toEqual({ tipo: 'enviado' })
    expect((await pedirCodigoDeVerificacion({ reauthenticate: jest.fn(async () => ({ data: null, error: errorAuth('AuthApiError', { status: 429 }) })) } as never)).tipo).toBe('limite')
    expect((await pedirCodigoDeVerificacion({ reauthenticate: jest.fn(async () => ({ data: null, error: errorAuth('AuthSessionMissingError') })) } as never)).tipo).toBe('sesion_expirada')
    expect((await pedirCodigoDeVerificacion({ reauthenticate: jest.fn(async () => { throw errorAuth('AuthRetryableFetchError', { status: 0 }) }) } as never)).tipo).toBe('sin_conexion')
  })
  it('todos los mensajes están en español y no incluyen detalles del proveedor', () => {
    for (const tipo of ['reautenticar', 'codigo_invalido', 'misma_contrasena', 'rechazada', 'sesion_expirada', 'usuario_distinto', 'sin_conexion', 'error'] as const) {
      const texto = mensajeDeActualizacion({ tipo })
      expect(texto).toMatch(/[a-záéíóú]/u)
      expect(texto).not.toMatch(/AuthApiError|jwt|token/iu)
    }
  })
})

describe('urlDesdeParametros', () => {
  it('reconstruye el retorno con las claves conocidas y lo deja pasar por el mismo parser', () => {
    const url = urlDesdeParametros({ code: CODIGO, sb_flow_id: FLUJO, otra: 'x' })
    expect(url).toBe(`educarparatransformar://restablecer?code=${CODIGO}&sb_flow_id=${FLUJO}`)
    expect(interpretarEnlace(url)).toEqual({ tipo: 'codigo', codigo: CODIGO, flowId: FLUJO })
  })
  it('sin claves conocidas no hay enlace', () => {
    expect(urlDesdeParametros({})).toBeNull()
    expect(urlDesdeParametros({ otra: 'x' })).toBeNull()
  })
  it('un parámetro repetido llega como lista y el parser lo rechaza por ambiguo', () => {
    expect(interpretarEnlace(urlDesdeParametros({ code: [CODIGO, CODIGO] }))).toEqual({ tipo: 'rechazado', motivo: 'invalido' })
  })
  it('codifica los valores: el error informado por Auth sigue siendo legible', () => {
    const url = urlDesdeParametros({ error: 'access_denied', error_code: 'otp_expired', error_description: 'Email link is invalid or has expired' })
    expect(interpretarEnlace(url)).toEqual({ tipo: 'rechazado', motivo: 'expirado' })
  })
})
