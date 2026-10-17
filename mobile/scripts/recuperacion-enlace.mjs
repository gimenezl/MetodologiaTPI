// Entrega a la aplicación el enlace del correo de recuperación capturado por Mailpit (EPT-106).
//
// Imprime en la salida estándar SOLO la URL de retorno de la app (`educarparatransformar://restablecer?code=…`),
// pensada para asignarse a una variable enmascarada del runner. Es un código de un solo uso del stack
// descartable; nada más se escribe en la salida y los errores no incluyen el enlace.
import assert from 'node:assert/strict'

import { borrarCorreos, esperarCorreo, extraerEnlaceDeVerificacion, resolverRetornoDeApp, validarMailpitLocal } from './recuperacion-utils.mjs'

try {
  const mailpit = process.env.EPT_RECUPERACION_MAILPIT_URL
  const api = process.env.EPT_RECUPERACION_API_URL
  const destinatario = process.env.MAESTRO_RECUPERACION_EMAIL
  assert.ok(mailpit && api && destinatario, 'Faltan los datos del actor de recuperación exportados por la integración.')
  validarMailpitLocal(mailpit)
  const correo = await esperarCorreo(mailpit.replace(/\/$/u, ''), destinatario)
  const enlace = extraerEnlaceDeVerificacion(correo, api.replace(/\/$/u, ''))
  const retorno = await resolverRetornoDeApp(enlace)
  assert.ok(retorno.startsWith('educarparatransformar://restablecer'), 'La verificación no regresó al destino de la app.')
  await borrarCorreos(mailpit.replace(/\/$/u, ''), destinatario)
  process.stdout.write(retorno)
} catch (error) {
  console.error(`No se pudo preparar el enlace de recuperación: ${error instanceof Error ? error.message.replace(/https?:\/\/\S+/gu, '<url>') : 'error desconocido'}`)
  process.exitCode = 1
}
