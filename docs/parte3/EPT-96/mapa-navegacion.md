# EPT-96 — Mapa de navegación por rol

Las rutas son hashes (`#/…`) del prototipo. Toda ruta pasa por una guarda: sin sesión → ingreso; sesión expirada → ingreso con aviso; rol del canal web → orientación web; vínculo ausente, rol sin permiso o archivo ajeno → «Esta sección no está disponible para tu cuenta» (sin datos). La guarda ilustra el contrato; **no es autorización productiva**.

## Rutas

| Ruta | Pantalla (EPT-95) | PADRE vinculado | ESTUDIANTE propio | Canal web |
|---|---|---|---|---|
| `#/ingreso`, `#/recuperar`, `#/bloqueada`, `#/sesion-expirada` | W01/M01, V01–V04 | ✔ | ✔ | ✔ (aviso) |
| `#/canal-web` | V05 | — | — | ✔ |
| `#/hijos` | W02/M02, V06 | ✔ | ✘ | — |
| `#/h/:hijo/cuotas[/pagadas]` | W03/M03, V07–V13, V26 | ✔ | ✔ | ✘ |
| `#/h/:hijo/factura/:id` | W04/M04, V14 | ✔ | ✔ | ✘ |
| `#/h/:hijo/pagar` | W05/M05, V15 | ✔ | ✘ | ✘ |
| `#/h/:hijo/pago/:id` | V16 | ✔ (quien lo registró) | ✘ | ✘ |
| `#/h/:hijo/pago/:id/comprobante` · `/enviado` · `/incierto` | W06/M06, V17–V19, V25 | ✔ (quien lo registró) | ✘ | ✘ |
| `#/h/:hijo/comprobantes` | V20, V21 | ✔ (registro; original solo de quien cargó) | ✔ (solo registro) | ✘ |
| `#/h/:hijo/archivo/:id` | — (original simulado) | ✔ solo quien cargó | ✘ | ✘ |
| `#/h/:hijo/periodo` | W07/M07, V22 | ✔ | ✔ | ✘ |
| `#/h/:hijo/deuda` | W08/M08, V23 | ✔ | ✔ | ✘ |
| `#/h/:hijo/inscripciones` | W09/M09, V24 | ✔ | ✔ | ✘ |
| `#/sin-permiso` | — (guarda) | ✔ | ✔ | — |

## Flujo PADRE

```text
ingreso → hijos → cuotas ⇄ factura → pagar → pago registrado → comprobante → enviado
                     │                    │                        └→ incierto → (revisar estado) → recibido | reintento único
                     │                    └→ cancelar / volver (descarta la selección)
                     ├→ comprobantes → archivo simulado (solo quien cargó)
                     └→ período · deuda · inscripciones (barra inferior)
```

- **Cambiar hijo** vuelve al selector y descarta selección, borrador y filtros del hijo anterior.
- **Cancelar** en el formulario descarta el borrador; el pago registrado permanece «pendiente de verificación» y se retoma desde «Pagos y comprobantes».
- **Reiniciar prototipo** (panel de simulación) restaura la base ficticia, cierra la sesión y desactiva los escenarios.

## Flujo ESTUDIANTE

```text
ingreso → cuotas ⇄ factura (solo consulta)
            ├→ comprobantes (solo registro)
            └→ período · deuda · inscripciones
```

Sin selector de hijo, sin «Pagar ítems», sin carga ni original. Los intentos directos a `#/hijos`, `#/h/*/pagar`, `#/h/*/pago/*`, `#/h/*/archivo/*` o a otro estudiante terminan en `#/sin-permiso`.

## Canal web

DIRECTOR, DOCENTE y PERSONAL ingresan y reciben «Esta aplicación es para padres, madres y estudiantes», sin barra de navegación ni información económica; cualquier ruta móvil los devuelve a `#/canal-web`.
