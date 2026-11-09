# Presentación final — Parte 3 (aplicación móvil integrada con la plataforma web)

Guion y estructura de diapositivas. Cada diapositiva cita su evidencia en el repositorio; no se agregan métricas que no estén en esos documentos. Estado redactado el 2026-11-09.

## 1. Portada

- Educar Para Transformar — Parte 3: aplicación Expo/React Native sobre la misma plataforma web.
- Equipo / responsable: Lucas Gimenez. Fecha de presentación: a confirmar por el equipo.

## 2. El problema

- Las familias necesitan consultar cuotas e inscripciones, elegir qué pagan y subir comprobantes desde el teléfono.
- Dirección necesita verificar esos pagos y conciliarlos con los informes de la web.
- Restricción: una sola base y un solo backend; sin duplicar reglas ni importes.

## 3. Arquitectura web-móvil compartida

- App Expo en `mobile/`; backend Next.js existente y misma base PostgreSQL/Supabase (Auth, RLS, Storage).
- Contrato Bearer para el móvil; el backend web sigue validando cookies para la web. Sin `service_role` ni módulos de servidor en el dispositivo.
- Importes exactos calculados en servidor (centavos); archivos privados con URL firmadas.
- Mismas cuentas, vínculos padre-hijo, bloqueos y RLS que la web.

## 4. Ciclo económico probado en Android e iOS (EPT-119)

Fuente: `docs/evidence/EPT-119.md`.

- Mismo ciclo sobre los mismos registros, en emulador Android y simulador iOS, con Supabase local real y servidor web real.
- Pasos: padre consulta cuotas, elige ítems, registra dos pagos, adjunta comprobante, Dirección aprueba uno y rechaza otro desde la web, la app y la web reflejan saldo y recibo.
- Resultado registrado: Android e iOS pasaron en el run de CI citado en el informe (iOS con un reintento por «iOS driver not ready in time»).
- Limitación abierta documentada: intermitencia del selector de fotos en iOS (P-02), causa no demostrada.

## 5. Seguridad y RLS (EPT-120)

Fuente: `docs/evidence/EPT-120.md`.

- Matriz recurso × actor × canal × operación sobre API y Storage reales; cada negativa con su positiva previa.
- Original del comprobante: solo quien lo cargó y Dirección; recibo institucional como recurso aparte, sin URL pública.
- PERSONAL sin acceso económico; DIRECTOR verifica pero no edita importes.
- Limitaciones declaradas: las URL firmadas ya emitidas siguen vigentes hasta vencer (L-01/L-02); el endpoint del original autentica solo por cookies (E02).

## 6. Producción (EPT-122)

Fuente: `docs/evidence/EPT-122.md`.

- Migraciones: el ledger de producción ya contenía todas las de `main` al 2026-11-09; no hubo nada que aplicar.
- Cron diario de facturación registrado en `vercel.json`, protegido con `CRON_SECRET`.
- La facturación sigue inerte hasta habilitar la bandera y la compuerta privada de la base; no se activaron efectos monetarios.
- `recordatorio-mensual` y `aviso-deuda` siguen sin agenda y con compuertas apagadas.

## 6 bis. Generación de APK (EPT-123)

- **En curso / no terminada.** La tarjeta EPT-123 está en Por hacer en Jira al 2026-11-09. No se afirma que el APK esté listo.
- No existe `docs/evidence/EPT-123.md` en `main` al redactar esto; no hay evidencia que citar.

## 7. Manual de usuario (EPT-126)

Fuente: `docs/parte3/EPT-126/manual-usuario-movil.md`, evidencia en `docs/evidence/EPT-126.md`.

- Cubre ingreso, cuotas, pagos, comprobantes, consulta por período, recibos, deuda, inscripciones, recuperación de contraseña y problemas frecuentes.
- Pendiente: las capturas de la app ejecutada (13 listadas en la sección 15 del manual); no están en el repositorio.

## 8. Informe de IA (EPT-127)

Fuente: `docs/parte3/EPT-127/informe-ia.md` y `bitacora-unificada.md`.

- Relación web-móvil, bitácora vinculada a tarjetas, comparación IA vs sistema, reflexión crítica.
- Estado parcial declarado: EPT-105 y EPT-122 sin registro de IA en el repositorio; aprobación docente y prompts literales pendientes.

## 9. Evidencia Kanban

Fuente: `docs/parte3/EPT-128/evidencia-kanban.md` (instantánea de Jira del 2026-11-09).

- Tablero real agrupado por épica con conteos Listo / En curso / Por hacer.
- Capturas del tablero y evolución histórica: pendientes del equipo.

## 10. Riesgos y pendientes honestos

| Tema | Estado |
|---|---|
| APK Android y acceso iOS (EPT-123) | No terminado |
| Tarifas y datos iniciales (EPT-124) | Por hacer |
| Presentación en testing 11/11/2026 (EPT-125) | Por hacer |
| Informe de IA (EPT-127) | Por hacer en Jira; contenido parcial en el repositorio |
| Alta de vínculos padre-hijo (EPT-164) | Por hacer |
| Intermitencia del selector de fotos en iOS (P-02) | Abierta, causa no demostrada |
| Revocación inmediata de URL firmadas | No disponible en Storage (L-01/L-02) |
| Facturación, recordatorios y avisos en producción | Inertes hasta habilitar compuertas |
| Capturas del tablero, retrospectivas, capturas del manual | Pendientes del equipo |

## 11. Cierre

- Qué funciona y está probado con evidencia: ciclo económico móvil-web, matriz de acceso, migraciones al día, cron registrado.
- Qué falta y quién lo decide: los pendientes de la tabla anterior.
- Preguntas.
