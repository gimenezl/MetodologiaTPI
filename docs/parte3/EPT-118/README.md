# EPT-118: correos programados probados de extremo a extremo y canal de Dirección

Tarjeta «[P3-T31] Probar correos programados en Mailpit». Es verificación: no cambia reglas económicas, migraciones ni automatizaciones productivas. Baseline `origin/main` `587caa846b94de858c7978547e52b1884610a1d3` (PR #71, EPT-117).

[Matriz de cobertura](matriz-cobertura.md) · [Evidencia](../../evidence/EPT-118.md)

## Qué se entrega

1. **Cobertura SMTP focal** en `supabase/tests/recordatorio-api.mjs` (transporte compartido por recordatorio y aviso):
   - rechazo `554` al comando `DATA`, `451` y `554` al terminar `DATA`: `FALLIDO`, con el código saneado y reintento diario;
   - corte de la conexión tras el `354` (frontera cruzada, sin respuesta): `INCIERTO`, sin reenvío; y el corte previo a `DATA` (en `RCPT TO`): `FALLIDO`, porque la fase, no el código, decide;
   - el intermediario TCP registra lo que hizo de verdad y Mailpit nunca recibe el mensaje en esos casos: el estado durable se contrasta con la realidad, no con `error.code`.
2. **Lectura de la pantalla de Dirección con identidades reales** (misma consulta que usa la página): estudiante, docente, personal, anónimo y Dirección bloqueada con JWT vigente no reciben filas.
3. **Canal de Dirección** `/dashboard/envios-correo`: vista de solo consulta, descrita abajo.
4. **Guarda `ept118`** en el fixture de correo: se añade a la lista cerrada (`ept115`, `ept116`, `ept118`, `ept104`) sin relajar localhost, contenedor ni puerto.
5. **Inspección visual de PDF** recibidos en Mailpit y de las muestras del generador (ver evidencia).

## Dos tipos de correo, dos contratos

| | Recordatorio mensual (EPT-115) | Aviso de deuda (EPT-116) |
|---|---|---|
| Primer evento | último día hábil del mes (fines de semana y feriados nacionales) | día 20 calendario, aunque sea feriado o fin de semana |
| Contenido | un correo por padre con sus hijos autorizados | un correo por padre con deuda de sus hijos autorizados |
| Adjuntos | **un PDF de factura del mes siguiente por hijo** | **ninguno** (contrato específico de EPT-116) |
| Reintento tras fallo claro | diario hasta el día 10 inclusive | diario hasta fin de mes inclusive |
| Saldo cero | no aplica | sin fila ni envío |
| Revalidación | cuenta, vínculos y facturas en cada intento | cuenta, vínculos y saldo en cada intento (`EN_VERIFICACION` sigue siendo deuda) |

La frase genérica «PDF por hijo» de la planificación **no** extiende los adjuntos al aviso de deuda: el contrato integrado de EPT-116 es que el aviso no adjunta nada, y las pruebas lo verifican contra Mailpit.

Para ambos: un resultado incierto no se reintenta automáticamente; `ENVIADO` significa aceptación por el servidor SMTP, no lectura ni recepción en el buzón final; SMTP no es transaccional con PostgreSQL, así que no se promete entrega exactamente una vez bajo cualquier falla, y la política ante la duda prioriza evitar duplicados. Las compuertas siguen independientes y apagadas en producción.

## Canal de Dirección

- **Ruta:** `/dashboard/envios-correo`, enlace «Correos programados» en el menú de Dirección. Ocultar el menú no autoriza: la página llama a `requerirDirector` y RLS vuelve a exigir el rol en la lectura.
- **Solo consulta.** No hay reenviar, reabrir `INCIERTO`, marcar resuelto, borrar ni cambiar destinatario. Esas acciones introducirían reglas y transiciones no autorizadas.
- **Datos por fila:** tipo, estado, fecha programada original, período (si corresponde), destinatario (`apellido, nombre` del perfil del padre), intentos, fecha del último intento y motivo saneado. No se muestran DNI, teléfono, correo ni importes.
- **Lectura:** sesión del usuario y RLS; sin `service_role`; columnas listadas una por una (la tabla guarda `reserva_token`, `reserva_hasta` y `frontera_smtp_en`, que no se piden). El motivo se trunca a 300 caracteres y cualquier dirección de correo se reemplaza por «[correo oculto]».
- **Orden y límite:** `fecha_programada` descendente, `id` descendente; 50 filas por página; «Anterior»/«Siguiente» por enlaces. Se pide una fila de más para saber si hay otra página sin contar la tabla.
- **Filtros:** tipo y estado por enlaces, con lista cerrada (un valor desconocido se ignora).
- **Estados de la interfaz:** carga (`loading.tsx`), vacío, error de lectura con «Reintentar» (`PanelErrorEnviosCorreo`) y error inesperado con reintento (`error.tsx`).
- **INCIERTO:** aviso fijo en texto («pudo haber sido aceptado por SMTP… no se reintenta automáticamente») y marca en cada fila `INCIERTO`; no depende solo del color.

## Cómo reproducir localmente

Stack aislado propio (no reutilizar los de otras unidades):

```bash
# config.toml local con project_id = "ept118" y puertos 6012x (sin commitear)
npx --no-install supabase start
export EPT_SUPABASE_WORKDIR="$PWD" EPT_SUPABASE_DB_CONTAINER=supabase_db_ept118 EPT_TEST_SMTP_PORT=60125
node supabase/tests/recordatorio-api.mjs
node supabase/tests/aviso-deuda-api.mjs
node supabase/tests/factura_pdf.mjs
node supabase/tests/recordatorio-calendario.mjs
node supabase/tests/aviso-deuda-calendario.mjs
EPT_PUERTO_APP=31118 EPT_BASE_URL=http://localhost:31118 node supabase/tests/correr-autenticadas.mjs envios-correo-auth.spec.ts
```

`EPT_PDF_MUESTRAS=<carpeta fuera del repositorio>` hace que `recordatorio-api.mjs` y `factura_pdf.mjs` guarden los PDF para inspeccionarlos con un rasterizador. `scripts/ci/database.mjs` solo corre en el runner GitHub Linux descartable.

## Rollback

Revertir el cambio retira la pantalla, el enlace del menú y las pruebas. No se borra auditoría ni se reinician estados de correo; nada puede «desenviar» un mensaje ya aceptado por SMTP.
