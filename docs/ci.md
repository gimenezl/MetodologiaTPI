# Verificación automática por pull request

Cada PR ejecuta tipos, lint, pruebas puras existentes, build y cuatro recorridos públicos en Chromium. `CI / gate` siempre aparece y falla si falta un resultado requerido. No usa secretos de producción.

| Perfil | Selección | Comprobaciones adicionales |
|---|---|---|
| `fast` | Documentación y pruebas puras conocidas | Ninguna base ni matriz completa |
| `db` | Backend mensual acotado o suites SQL/API | Base nueva, RLS, concurrencia, API real y tipos reproducibles |
| `full` | Migraciones, auth compartida, dependencias, CI o rutas desconocidas | Lo anterior más mutaciones y matriz Playwright original completa |

Renombres consideran origen y destino; eliminaciones también cuentan. Un cambio desconocido nunca obtiene el perfil rápido. Ejecución manual y domingo 06:00 UTC (03:00 Argentina) usan `full`.

`scripts/ci/suites.mjs` es el registro compartido del selector y el runner. Las mutaciones requieren `full`; paridad y reconciliación real forman parte de `db`. Una suite nueva no registrada bloquea el plan. Helpers son dependencias de `full`, no pruebas ejecutables. Los procedimientos de producción, preflight, carga, replay/reversión históricos y setup manual están excluidos del CI general; cambiarlos exige registrar una comprobación específica segura, nunca ejecutarlos por extensión.

## Ejecución y seguridad
- `node --test scripts/ci/impact.test.mjs` verifica la selección.
- `npx playwright test --config=playwright.pure.config.ts` no inicia servidor ni Docker.
- El smoke usa `npm run build` y un servidor de producción propio en 3100.
- El runner DB solo admite GitHub Linux desechable: CLI 2.117.0, stack ept104, reset sin seed. Restaura config y detiene únicamente su stack; Mailpit permanece local. La suite de expansión legada no corresponde al esquema contraído actual.
- Se conserva la matriz original de actores, bloqueados y dispositivos, con un worker para fixtures compartidas. El perfil completo puede tardar más de 30 minutos; no es obligatorio en cada edición documental.
- Solo se sube un resumen de revisión/perfil/cantidad de suites: no claves, JWT, `.env`, estados autenticados ni traces.
- La protección de `main` debe exigir el check de GitHub Actions `CI / gate`; no basta un preview de Vercel. La configuración remota es una operación separada.

## Medición
Los runs iniciales 37847128039 y 37848873378 detectaron, respectivamente, una invocación SQL con propietario incorrecto y un fixture API anterior al recorte por vínculo de EPT-66 D. Se corrigen el rol del runner y el contexto académico sintético; no se alteran permisos ni se excluyen controles de privacidad.

Registrar duración y SHA del primer run completo y de los rápidos posteriores en la entrega de Unidad 4. Los 31,5 minutos/1936 casos citados en EPT-103 son una medición histórica, no el resultado de este CI. Comparar ejecuciones equivalentes; no presentar menos cobertura como mayor velocidad.

Mobile todavía no tiene paquete ejecutable: no se declara probado. El selector bloquea paquetes mobile/Expo/React Native hasta incorporar sus comandos reales; `full` web no los certifica.
