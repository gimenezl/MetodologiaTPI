# EPT-117 · Pruebas económicas y de calendario (P3-T30)

Tarea de verificación de la Parte 3. No añade funcionalidad ni migraciones: demuestra, sobre la implementación real, los contratos de composición mensual, cálculo exacto, imputaciones, saldos y último día hábil.

## Alcance

- Se **extienden** dos suites DB ya registradas (`facturacion.mjs`, `recordatorio-calendario.mjs`). No hay suite nueva ni cambios en `scripts/ci/`, workflows, fixtures `_*.mjs` o tipos, de modo que el selector de CI (`scripts/ci/impact.mjs`) solo activa el perfil **DB**, sin UI ni móvil.
- Matriz criterio → contrato → caso → resultado: [`matriz-cobertura.md`](./matriz-cobertura.md).
- Evidencia de ejecución, revisión y bitácora: [`../../evidence/EPT-117.md`](../../evidence/EPT-117.md).

## Qué se añadió

| Brecha | Caso nuevo | Dónde |
|---|---|---|
| Composición verificada solo por conteo y total | Oráculo por ítem (concepto, origen, importe) y total, escritos a mano | `facturacion.mjs`, caso 3 |
| Vigencia de tarifa sin los días vecinos del borde | `desde`/`hasta` un día antes y en el propio día 1 | `facturacion.mjs`, caso 8 |
| Importes monetarios no probados como NUMERIC exacto | Catálogo: sin `real/double/money`, escala 2 | `facturacion.mjs`, caso 13 |
| Ciclo de pago sin centavos reales | Selección parcial → reserva → aprobación → saldo → reintento → rechazo → pago final | `facturacion.mjs`, casos 14–21 |
| Calendario sin P6841, sin combinaciones fin de semana + feriados y sin enero 2027 | Cuatro casos con feriados sintéticos locales | `recordatorio-calendario.mjs`, casos 5–7 |

## Reproducir (stack local descartable)

1. Stack propio y aislado (no usar ni modificar otros): copiar `supabase/config.toml` a un directorio de trabajo, cambiar `project_id` y todos los puertos, enlazar `migrations` y `tests`, y ejecutar `npx supabase@2.117.0 start --workdir <dir>`.
2. Variables: `EPT_SUPABASE_WORKDIR=<dir>` y `EPT_SUPABASE_DB_CONTAINER=supabase_db_<project_id>`. Los fixtures solo aceptan un stack llamado `ept104` (el de CI) u otros nombres propios ya listados; para un stack con otro nombre se usa una copia temporal de `supabase/tests` con esa guarda ampliada **fuera del repositorio**.
3. `node supabase/tests/facturacion.mjs` y `node supabase/tests/recordatorio-calendario.mjs`.
4. En CI las ejecuta `scripts/ci/database.mjs` sobre el stack `ept104`; ese runner solo funciona en GitHub Linux y no se simula localmente.

## Datos y seguridad

- Todo es sintético y local; los feriados insertados son **sintéticos de prueba** (no fechas nacionales) y se retiran en `finally`.
- Los actores operan con `SET ROLE` + JWT, como PostgREST; el propietario solo prepara fixtures y lee estado.
- Sin producción, SMTP, cron ni migraciones.

## Rollback

Revertir el PR (solo cambia pruebas y documentación). No hay estado de producción que deshacer.
