# Reset y matriz integral de validación

## Alcance autorizado

El usuario declaró descartables los datos de negocio sintéticos de local y cloud
y solicitó un reset completo seguido de una matriz natural para probar todos los
flujos. No es un permiso de borrado de datos reales ni un endpoint del producto.
No se eliminan identidades Auth, Google, credenciales, proveedores, sesiones ajenas,
roles existentes, perfiles vinculados, infraestructura, buckets, schemas, políticas
o ledger. El ADMIN principal conserva su UUID, Auth link y acceso exclusivo ADMIN.

No se ejecuta en CI ordinaria, deploy, Vercel, middleware ni automáticamente.
Toda operación canónica requiere PLAN separado local/cloud, revisión del hash y
APPLY explícito. Un PLAN viejo de solo ocho certificados no autoriza este reset.

El job manual tiene un plazo operativo de 40 minutos, no un timeout de tests.
El intento observado con 20 minutos avanzó continuamente de 91 a 3755 queries,
sin locks ni queries estancadas, antes de rollback por deadline. El mismo flujo
real en el caso gestionado existente envía 4525 queries; a las ~3.1 queries/s
observadas necesita ~24 minutos. El margen finito evita cancelar trabajo sano.
No se modifican plazos de CI/E2E, retries, casos o guards para ocultar defectos.

## Orden operativo obligatorio

1. Integrar todos los PR aprobados en `development`, con gates verdes y revisión.
2. Congelar el SHA integrado y verificar CI completo. Generar PLAN del schema
   histórico **24**: tablas, claves, hashes completos, columnas, FKs, triggers,
   ajustes, perfiles y objetos Storage. MAIN aprueba destino y hash exactos.
3. Ejecutar el reset de negocio antes del release: `0024` exige estudiantes e
   interesados vacíos; `0025` exige certificados vacíos. El deploy aplica
   migraciones **antes** de publicar runtime; esperar READY para vaciar sería tarde.
4. Limpiar únicamente los objetos aprobados, ya desconectados de sus referencias,
   mediante Storage API/CLI autenticada. Nunca SQL sobre `storage.objects`.
5. Aplicar migraciones normales localmente y mediante el release combinado a
   `master` en cloud. Los 24 hashes/timestamps anteriores no cambian; el source
   final incluye 0024/0025/0026, ledger **27**. No modificar manualmente el ledger.
6. Verificar release exacto, CI first-pass completo y Vercel READY/alias canónico.
7. PLAN/APPLY independientes de preparación, negocio, invitaciones, cobertura de cuentas y certificados.
   Cada etapa tiene su hash/receipt; no obtiene permiso porque otra pasó.
8. Smoke por rol, nombres/slugs/reportes/PDFs, QR/hash/download privado, replay
   no-op y cleanup de sesiones/procesos temporales. No afirmar firma institucional.

Durante los pasos 3–7 hay una ventana de mantenimiento con datos vacíos. No
permitir escrituras concurrentes sobre el schema anterior. El checkout/runtime
compartido, `.env` y el ajuste local `supabase/config.toml` se preservan; su
actualización/reinicio se coordina expresamente, no se deduce del reset.

## Herramientas y límites

- `full-validation-native-inventory.ts`: una sola consulta/hash PostgreSQL para
  local y cloud; transporte cloud usa la sesión Supabase CLI existente sin
  exportar passwords/keys. Read-only; tablas desconocidas bloquean.
- `full-validation-reset-sql.ts`: transacción revisada sobre allowlist explícita,
  locks, principal confirmado/ADMIN exclusivo, comparación atómica del PLAN y
  `TRUNCATE ... RESTRICT`. Sin CASCADE, DROP ni deshabilitar triggers. Solo los
  budgets TTL Auth/link/interés quedan fuera del hash de filas porque el login
  normal puede cambiarlos; nunca se truncan.
- `full-validation-reset.ts`: PLAN, RESET o limpieza Storage manuales; RESET exige
  source limpio/SHA exacto, CI combinado verde, destino y hash. Guarda un receipt
  durable antes de las etapas externas. Paths/planes privados fuera del repo.
- `full-validation-seed.ts`: etapas por servicios reales, sin reset o migración
  implícitos. Ledger exacto contra journal/SQL del checkout; no basta el conteo.
- `production-full-validation.yml`: `workflow_dispatch`/master/environment
  production únicamente, con concurrencia común al operador existente. Verifica
  la release READY y los artefactos first-pass; secretos permanecen internos.
  Solo sube resumen redactado, nunca contactos, paths, planes crudos o keys.

La allowlist actual vacía 29 tablas de negocio, incluida auditoría app y antiguos
manifiestos seed; conserva 12 tablas de cuentas/perfiles/roles/settings/budgets.
Auth logs y schemas Auth/Storage/Drizzle quedan fuera. Se inspeccionan todas las
dependencias: un FK externo o trigger de TRUNCATE inesperado bloquea. Objetos
solo en `certificate-documents` y `course-artwork`, por path/ID aprobado; se
preservan buckets/config. El hash inicial cubre metadata, no acredita descarga
reciente de bytes; la comprobación de los PDFs nuevos usa sus bytes reales.

Fallos: antes de commit todo el reset revierte; después consultar el receipt,
nunca repetir a ciegas. Limpieza Storage tiene progreso por objeto y se detiene
si aparece un objeto nuevo, cambia el ledger o se recrean referencias. Un APPLY
de negocio es atómico; errores de certificado conservan las reservas/outbox
reales y requieren inspección, no eliminación para ocultar el fallo.

## Matriz natural

El anchor Bolivia se revisa y congela; el replay no mueve fechas. La matriz usa
4 formatos activos/inactivos de 20/30 horas (crece si N exige más sesiones),
12 cursos, 18 grupos, 34 preinscripciones y 33 identidades globales compartidas
por CI. Hay 10 publicados, un borrador y un archivado; cohortes terminadas,
actuales, futuras y cuatro del siguiente año. Slugs y programas son propios de
cada curso, sin `demo-*`, Lorem o etiquetas de escenario en la UI.

Estudiantes e interesados reciben `firstName`, `paternalSurname` y
`maternalSurname` explícitos; no se infieren apellidos históricos. Emails
`example.test` no se entregan; los CIs son strings sintéticos, no identidad real
verificada. Se reutilizan instructores/ADMIN retenidos con perfiles naturales;
los nombres antiguos requieren una edición normal auditada y PLAN específico.
Dos invitaciones internas adicionales muestran `INVITED`, sin Auth identity,
correo enviado, verificación fabricada o cambios a roles existentes.

Solo tres de los cuatro instructores activos retenidos reciben cursos; el cuarto
permanece realmente activo sin asignaciones. La etapa `coverage` recibe el UUID
explícitamente revisado de otro instructor retenido, natural, sin cursos y con
Auth link. Lo desactiva mediante el lifecycle normal, sin borrar credenciales,
roles o proveedores. Verifica filas reales para ADMIN/INSTRUCTOR en ACTIVE,
INVITED y DISABLED, más instructores activos con/sin cursos; guarda la cobertura
por UUID/conteo. Si el target no conserva esos perfiles o aparece una asignación,
PLAN/APPLY bloquea en lugar de fabricar una identidad verificada.

Cobertura funcional: pago mínimo/completo, auxiliar/descuento/gratuito,
cancelación/devolución/transferencia/conversión; notas aprobadas/reprobadas/cero/
límite/pendientes; asistencia presente/ausente/justificada, aviso N y restricción
N+1, revisión histórica, cancelación/recuperación; cierres oficiales y reapertura
legítima con motivo breve. Los snapshots nuevos usan identidades naturales. El
historial sintético usa el clock acotado del fixture existente; no se expone un
clock HTTP, se alteran políticas runtime ni se fabrican snapshots por SQL.

Certificados: un registro actual por grupo/tipo/destinatario elegible, ordinal
automático, solo v2. Alterna unsigned y archivo actual final; upload activa
atómicamente el documento actual. No usa review/issue/replacement antiguos.
Los finales técnicos llevan **DOCUMENTO DE PRUEBA - SIN FIRMA INSTITUCIONAL**;
no hay autógrafos inventados ni supuesto escaneo legal. Se verifica SHA-256 de
bytes descargados y el replay no vuelve a generar/subir. Los tests amplían el
caso existente del seed; no se añaden suites/specs/casos ni retries/skips.

## Ejecución manual

PLAN y evidencia deben ir fuera del checkout, en ubicación privada aprobada.

```text
bun scripts/full-validation-reset.ts --mode plan --target local --project skillbase --actor-id <UUID> --local-config-workdir <canonical-root> --output <private-plan.json>
bun scripts/full-validation-reset.ts --mode plan --target production --project fvzxqlezdrlzykyoevub --allow-production --actor-id <UUID> --output <private-plan.json>
```

RESET/Storage requieren además `--plan-file`, `--reviewed-plan-sha256`,
`--approved-source-sha` y `--source-ci-run-id`. No se copian comandos con hashes
antiguos. Después del schema completo, `full-validation-seed.ts --stage
prepare|business|invitations|coverage|certificates --mode plan|apply` recibe el actor,
operation UUID, anchor y planes privados de nombres/cuentas. APPLY añade el
hash exacto; certificados finales añaden aprobación explícita de documento de
prueba. Producción se ejecuta solo desde el workflow protegido nuevo.

Este documento describe implementación y procedimiento; por sí solo no acredita
APPLY canónico/cloud, release, disponibilidad o validación legal.
