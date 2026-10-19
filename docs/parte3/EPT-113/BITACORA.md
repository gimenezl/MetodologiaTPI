# Bitácora académica EPT-113

## Unidad y autorización

19 de octubre de 2026. RF7/RF10, tarjeta EPT-113; EPT-73 es solo la épica de referencia. Baseline remoto verificado por la sesión: `5a2ebc7c385f91df74e3124f4c022efe6f7cbca1`. Checkout humano y Expo preservados; implementación en worktree dedicado y un único escritor.

El usuario autorizó explícitamente `size:exception` para un único PR con revisión focal por bloques. No se heredó la excepción de EPT-112. No se usó SDD ni se cambió el interruptor RDD.

## Decisiones y aprendizaje

| Momento | Trabajo y fundamento |
|---|---|
| Preparación | Jira/PDF y dependencias EPT-111/84/80 verificados por la coordinación. Sin nuevos hijos en la última lectura. |
| Base | Identidad y fuente privada en la misma transacción; secuencia segura y recuperación antes del retorno temprano. |
| Descarga | PDF bajo demanda evita una transacción distribuida ficticia con Storage; un renderer fallido no revierte pagos. |
| Móvil | Se verificaron APIs SDK57 y redirecciones nativas de expo/fetch; se agregó expo-sharing compatible, sin reutilizar transporte JSON. |
| Pruebas | Fallo inicial de columnas RPC, transferencia de ArrayBuffer en unpdf y fixtures heredados sin recibos detectados y corregidos. Ninguna negativa se retiró. |
| Normalización | Se corrigieron UTF-8/LF de archivos editados en Windows antes de la revisión. Los scripts bash se conservan LF en Git. |
| PDF | Muestra sintética de 9 páginas, 75 ítems y acentos revisada visualmente, con verificación adicional de coordenadas y texto. |
| Gates | Evidencia local focal; CI sobre SHA final y revisión independiente a cargo de coordinación. No se afirma aprobación ni cierre anticipado. |

## Revisión y entrega

Ruta sugerida para revisión independiente: (1) transacción/locks/ACL y fuente; (2) renderer, API y dinero; (3) autorización por recurso; (4) transporte/limpieza/contexto móvil; (5) rutas de historial, paginación y cobertura CI. Los resultados deben registrarse con evidencia del candidato exacto antes de integrar.

No se inventó aprobación docente, humana o legal. PR, checks finales, squash merge, publicación de evidencia y transición Jira permanecen a cargo de la coordinación hasta que los gates reales lo permitan.


### Corrección focal de revisión

La revisión independiente detectó un único P2: menú nativo abierto después de 60 s dejaba el botón de recibo cargando indefinidamente. La descarga ahora notifica su finalización antes de compartir para detener el timeout de red; toda resolución del intento vigente termina su estado, y un cambio de cuenta/recibo descarta progreso/resultado anterior. Se conservan cancelación y límite de red. Pruebas focales: 20/20 (3,14 s), TypeScript (3,09 s), lint sin errores (2,67 s). No hubo nueva matriz larga. Primer draft PR67/head17b39ad inició CI39291239847; validación independiente de la corrección y CI del head final siguen pendientes. Rollback de esta unidad se limita al controlador móvil, callback de fase y sus pruebas; no toca datos ni migraciones.
