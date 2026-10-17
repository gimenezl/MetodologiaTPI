# EPT-106 · Recuperar y cambiar contraseña (RF2)

Cubre la tarjeta EPT-106 (`[P3-T24]`, sin subtareas). La evidencia (matriz de trazabilidad, comandos, resultados y
límites) está en [`docs/evidence/EPT-106.md`](../../evidence/EPT-106.md).

## Alcance

1. **Recuperación por correo.** Desde «Iniciar sesión» → «¿Olvidaste tu contraseña?», la persona pide un enlace.
   La app llama a Supabase Auth (`resetPasswordForEmail`); la confirmación es la misma exista o no la cuenta.
2. **Retorno seguro a la app.** El correo trae un enlace de Auth que redirige a
   `educarparatransformar://restablecer` con un código de un solo uso (flujo **PKCE**). La app lo canjea con
   `exchangeCodeForSession` y recién entonces permite fijar la contraseña nueva con `updateUser`.
3. **Cambio desde Mi cuenta.** «Seguridad» → «Cambiar contraseña» con la sesión vigente. Si Auth exige
   reautenticación (opción «Secure password change» y sesión no reciente), la app usa el mecanismo soportado:
   `reauthenticate()` envía un código por correo y se completa con `updateUser({ password, nonce })`.

Todo reutiliza Auth y el cliente Supabase singleton. **Sin migraciones**: no se tocó el esquema ni se creó ninguna
tabla, función SQL ni backend de autenticación. La app no usa `service_role` ni `admin.updateUserById`.

### Fuera de alcance

- Configuración de Auth, SMTP o usuarios de **producción** (ver «Configuración pendiente para release»).
- EPT-110 (inscripciones y facturas) y EPT-111 (aprobación de pagos), unidades posteriores e independientes.
- Política comercial de contraseñas (longitud, composición, caducidad): se usan las reglas vigentes de Auth y se
  muestran sus respuestas reales.

## Arquitectura del enlace

```
 Teléfono (app)                    Supabase Auth (GoTrue)            Correo
 ──────────────                    ──────────────────────            ──────
 1 resetPasswordForEmail(correo,
     redirectTo = educarparatransformar://restablecer)
     guarda el verificador PKCE ──▶ recover (code_challenge) ───────▶ enlace /auth/v1/verify?token=pkce_…
                                                                       │  (la persona lo abre en este teléfono)
 2 Auth valida el token y redirige a
     educarparatransformar://restablecer?code=<un solo uso> ◀──────────┘
 3 Expo Router abre /restablecer; la ruta lee el enlace (Linking + parámetros)
 4 interpretarEnlace(): destino exacto, parámetros no ambiguos, sin tokens del flujo implícito
 5 exchangeCodeForSession(code) + verificador local ──▶ sesión de la cuenta + PASSWORD_RECOVERY
 6 updateUser({ password }) sobre ESA sesión (se confirma con getUser antes y con la respuesta después)
 7 signOut local; la persona entra con la contraseña nueva
```

Decisiones:

- **PKCE y no flujo implícito.** El enlace solo lleva un código de un solo uso; sin el verificador guardado en el
  almacenamiento seguro de la instalación que lo pidió, no sirve. El cliente usa `flowType: 'pkce'`; el ingreso con
  contraseña no cambia. No se mezclan flujos: un retorno con `access_token`/`refresh_token` se rechaza.
- **Destino exacto.** `interpretarEnlace` solo admite el esquema `educarparatransformar` con el destino
  `restablecer` (sin subrutas); acepta únicamente `code` (obligatorio), `sb_flow_id`, y los parámetros de error de
  Auth. Un parámetro repetido o contradictorio es ambiguo y se rechaza. `type=recovery` o cualquier bandera local no
  autorizan nada: solo `exchangeCodeForSession` verifica, y además se exige que el canje sea una recuperación
  (`redirectType === 'recovery'`); un código válido de otro flujo cierra la sesión local y no abre el formulario.
- **Rutas desconocidas.** `+not-found` redirige al inicio sin mostrar los parámetros recibidos.
- **Entrega en frío, con la app abierta y repetida.** La ruta recibe el enlace por los parámetros del enrutador y
  por `Linking.useLinkingURL()`; manda el de la navegación que montó la pantalla. El canje se hace una sola vez por
  proceso: una entrega doble o el remonte reutilizan el resultado (Auth rechazaría el segundo canje y el SDK ya
  habría descartado el verificador).
- **Solo el último enlace pedido sirve.** El SDK de esta versión guarda un verificador “más reciente” por
  instalación (el identificador de flujo en la URL es opcional y no se activa). La pantalla lo avisa.
- **Falla de red durante el canje.** El SDK descarta el verificador aun si la petición falló; el enlace ya no se
  puede reintentar y la app ofrece pedir uno nuevo (se verificó contra el stack real).

## Aislamiento de sesiones

Mientras `ControladorRecuperacion` está activo se abre una *compuerta* (`recuperacion-activa.ts`). El
`ControladorAutenticacion` del acceso ordinario:

- ignora `PASSWORD_RECOVERY` siempre (nunca es un ingreso: no consulta roles ni envía a Cuotas);
- ignora los demás eventos de Auth y `revalidar()` mientras la compuerta está abierta;
- al cerrarse, vuelve a validar el acceso **solo si la sesión guardada cambió**. Cancelar, un enlace inválido o una
  falla no desmontan la pantalla, las cuotas ni una carga de comprobante en vuelo.

Con una sesión de otra cuenta abierta, la app **pide confirmación** antes de canjear (“Hay una sesión iniciada”).
Cancelar no cambia nada. Confirmar reemplaza la sesión local por la de la cuenta del enlace; la contraseña que se
cambia es siempre la de esa cuenta: antes de escribir se verifica con `getUser()` que la sesión sigue siendo la
esperada y, después, que `updateUser` devolvió el mismo usuario. Si la sesión cambió entre medio, no se escribe nada.
Un cierre real o el cambio de cuenta descartan el contexto de la anterior (las pantallas se identifican por
usuario y rol).

Tras el éxito se hace `signOut({ scope: 'local' })`: la sesión de recuperación no queda como ingreso y la persona
entra con la contraseña nueva. Los campos viven en un componente que se desmonta al terminar.

## Comportamiento real de las sesiones (observado, no garantizado)

En el GoTrue local usado para las pruebas, tras cambiar la contraseña el **access token y el refresh token de otra
sesión previa del mismo usuario fueron rechazados** (HTTP 403 y 400). Es una observación del stack local de CI; no se
asume que el JWT de otros dispositivos se revoque en producción ni de forma instantánea, ni se verificó producción.
La sesión desde la que se cambia sigue válida (el cambio desde el perfil continúa operando).

## Contraseña

Se envía tal como se escribió: no se recorta ni se normaliza. La app solo exige que no esté vacía y que coincida con
la confirmación; los requisitos (longitud mínima, composición, contraseña filtrada, “distinta de la actual”) son los
de Auth y se muestran en español. No se valida una contraseña anterior por cuenta propia.

## Entrega y pruebas por capa

| Capa | Qué prueba | Dónde corre |
|---|---|---|
| Jest (servicios, controlador, componentes, rutas reales de `app/` con `expo-router/testing-library`) | parser, errores, estados, doble entrega, otra cuenta, eventos `SIGNED_IN`/`PASSWORD_RECOVERY`/`USER_UPDATED`/`TOKEN_REFRESHED`, respuestas atrasadas | CI `móvil` y local |
| `integracion-recuperacion.mjs` | el **mismo código de la app** contra GoTrue y Mailpit reales (correo, enlace, canje, cambio, login nuevo, rechazo del anterior, identidades, vencido, reutilizado, red, otra cuenta, perfil y reautenticación) | CI Android (stack efímero) |
| Maestro `recuperacion-solicitud.yaml` + `recuperacion-cambio.yaml` | la UI en el emulador con el enlace real del correo | CI Android |
| Maestro `recuperacion-ios.yaml` | **solo lo nativo sin backend**: entrada desde el inicio de sesión, validación local del correo y flecha de volver. La entrega del enlace profundo **no** se pudo automatizar en el simulador (`openLink` no llegó a la app en dos ejecuciones de CI): el esquema se verifica en Android y el enrutamiento en Jest | CI iOS |

El flujo compartido `verificacion.yaml` (ronda su límite de 240 s) **no** recibió pasos nuevos.

## Configuración local y de CI (única autorizada)

El stack efímero de Android (`mobile/scripts/supabase-local.mjs`) ahora, solo para esa copia temporal:

- no excluye Mailpit (iOS sigue sin backend);
- agrega `educarparatransformar://restablecer` a `additional_redirect_urls`;
- sube `[auth.rate_limit] email_sent` de 2 a 100 (con 2 por hora no se podrían ejecutar las pruebas);
- activa `secure_password_change` para ejercitar la reautenticación (se simula una sesión de 3 días retrocediendo
  su reloj en la base efímera).

`supabase/config.toml` no cambió. Los relojes retrocedidos (vencimiento del enlace, del código y de la sesión) son
simulaciones locales documentadas.

## Configuración pendiente para release remoto

**No se tocó ni se verificó nada remoto.** Antes de afirmar que funciona en producción hay que, con autorización:

1. Agregar `educarparatransformar://restablecer` a *Authentication → URL Configuration → Redirect URLs*.
2. Configurar SMTP propio: el correo integrado de Supabase está muy limitado en tasa y no es apto para producción.
3. Revisar la plantilla «Reset Password» (debe conservar `{{ .ConfirmationURL }}`), la frecuencia mínima de envío y
   si «Secure password change» está activo (la app soporta ambos casos).
4. Probar el recorrido completo en un teléfono real con un buzón real.

## Riesgos y rollback

| Riesgo | Mitigación |
|---|---|
| El enlace se abre en otro teléfono o con la app reinstalada | no hay verificador: mensaje claro y “Pedir un enlace nuevo” |
| Se piden varios enlaces | solo sirve el último; la pantalla lo avisa |
| Límite de correos del proveedor | se informa el límite real; reenvío con espera de 60 s en la UI (no reemplaza al límite del proveedor) |
| Falla de red al canjear | el enlace queda inutilizado: se pide uno nuevo |
| Allowlist de redirección no configurada en remoto | Auth rechaza el destino; la solicitud no llega a la app (ver release) |

Rollback: es solo código de la app y del CI (sin migraciones). Quitar `flowType: 'pkce'` y las rutas
`recuperar`/`restablecer` restituye el comportamiento anterior; el ingreso con contraseña nunca dependió de ellos.

## Bitácora de IA

| Campo | Registro |
|---|---|
| Tarjeta | EPT-106 |
| Problema | recuperar y cambiar la contraseña desde la app reutilizando Auth, con retorno seguro por enlace profundo, sin mezclar cuentas y con pruebas reales de correo |
| Prompt | encargo completo de la unidad con el contrato de seguridad, de sesión y de CI por impacto |
| Respuesta | flujo PKCE con compuerta de recuperación, parser estricto del retorno, controlador con revisiones, cambio con verificación de usuario, integración real con Mailpit y escenarios Maestro |
| Comprensión y adaptación | se leyó el SDK instalado (`auth-js` 2.117.3): descubrió que `sb_flow_id` es opcional, que el canje descarta el verificador aun si falla la red y que `redirectType` distingue la recuperación; se descartaron el flujo implícito, `admin.generateLink` como prueba única y una tabla propia de contraseñas |
| Prueba | Jest (ver la evidencia), integración real contra GoTrue y Mailpit, escenarios Maestro (CI) |
| Resultado | ver `docs/evidence/EPT-106.md`. **No hay aprobación docente registrada ni inventada.** |
