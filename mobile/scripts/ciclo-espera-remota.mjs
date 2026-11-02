// Job macOS (EPT-119): espera, desde la perspectiva del padre, a que Dirección haya decidido los dos pagos que la
// app registró. Solo usa la sesión real del padre contra el backend de prueba (a través del túnel): sin service_role.
//   node mobile/scripts/ciclo-espera-remota.mjs <plataforma>
import { crearIdentidades } from './ciclo-identidades.mjs'

const plataforma = process.argv[2]
const base = process.env.EXPO_PUBLIC_SUPABASE_URL
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const limiteMs = Number(process.env.EPT_CICLO_ESPERA_DECISION_MS ?? 10 * 60_000)

async function main() {
  if (!['android', 'ios'].includes(plataforma)) throw new Error('Plataforma desconocida.')
  if (!base?.startsWith('https://') || !anon) throw new Error('Falta la URL https del backend de prueba o la clave anónima.')
  const { credencialDe, ids } = crearIdentidades(plataforma)
  const padre = credencialDe('padre')
  const fin = Date.now() + limiteMs
  let sesion = null
  for (;;) {
    if (!sesion || Date.now() > sesion.vence) {
      const r = await fetch(`${base}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' },
        body: JSON.stringify({ email: padre.email, password: padre.password }), signal: AbortSignal.timeout(20_000),
      })
      if (r.status !== 200) throw new Error(`No se pudo iniciar sesión como el padre del ciclo (HTTP ${r.status}).`)
      const cuerpo = await r.json()
      sesion = { token: cuerpo.access_token, vence: Date.now() + 60_000 }
    }
    const r = await fetch(`${base}/rest/v1/imputaciones_pago?select=item_factura_id,pagos(estado)&item_factura_id=in.(${ids.iA},${ids.iB})`, {
      headers: { apikey: anon, authorization: `Bearer ${sesion.token}` }, signal: AbortSignal.timeout(20_000),
    })
    if (r.status === 200) {
      const filas = await r.json()
      const estados = Object.fromEntries(filas.map(f => [f.item_factura_id, f.pagos?.estado]))
      if (estados[ids.iA] === 'APROBADO' && estados[ids.iB] === 'RECHAZADO') {
        console.log('Dirección decidió ambos pagos desde la web: aprobado y rechazado.')
        return
      }
    }
    if (Date.now() > fin) throw new Error('Se agotó la espera de la decisión de Dirección.')
    await new Promise(resolve => setTimeout(resolve, 3_000))
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/gu, '[JWT]') : 'Falló la espera de la decisión.')
  process.exitCode = 1
})
