# Demo financiero append-only (Fase 5)

Herramienta manual independiente: `scripts/financial-demo.ts`. **No se ejecuta en deploy**, no sustituye `renew-demo.ts` (que permanece local-only), no migra ni resetea bases. Su aplicación local/canónica/cloud queda pendiente de autorización coordinada después del release y gate combinado.

## Preparación y PLAN

Usar el checkout del release con migraciones requeridas, incluida 0018 (motivo opcional de efectivo), ya aplicadas mediante el flujo estándar. PLAN comprueba la columna requerida y aborta si falta; nunca aplica una migración. El runner exige configuración de preinscripción existente, ADMIN activo con identidad Auth existente y las tres identidades instructor del seed anterior con `app_metadata.seed_owner = skillbase-instructor-interest-demo-v1`. No crea cuentas, modifica passwords/roles/perfiles ni envía email.

Configurar solo en el entorno privado del operador o un archivo `.env` ignorado (nunca versionar ni imprimir valores):

- `DEMO_DATABASE_URL`: conexión PostgreSQL del destino aprobado.
- `DEMO_SUPABASE_URL`: API del mismo proyecto.
- `DEMO_SUPABASE_SERVICE_ROLE_KEY`: credencial servidor usada **solo para lectura** `getUserById`.
- `DEMO_ADMIN_ID`: UUID interno del ADMIN existente que será actor de auditoría y propietario de los receipts.

Local acepta únicamente `127.0.0.1:55322/postgres`, usuario `postgres`, y API `http://127.0.0.1:55321`; exige coincidencia exacta con `supabase status` del proyecto configurado. No detiene Supabase ni Astro (`4321`). Producción acepta exclusivamente el ref `fvzxqlezdrlzykyoevub`: conexión directa `db.<ref>.supabase.co:5432`, usuario `postgres`, o pooler oficial `aws-<n>-<región>.pooler.supabase.com:5432/6543`, usuario `postgres.<ref>`, DB `postgres`; API `https://<ref>.supabase.co`. No usar URLs de otros proyectos ni credenciales públicas para este comando.

Primero revisar el plan de lectura, con destino y proyecto **explícitos**:

```sh
bun scripts/financial-demo.ts --target local --project local
bun scripts/financial-demo.ts --target production --project fvzxqlezdrlzykyoevub
```

Sin `--apply`, la transacción de inspección es READ ONLY. Consulta configuración, colisiones, autorización, ownership y horarios existentes; no escribe filas. El primer plan usa el día actual de `America/La_Paz`; opcionalmente `--anchor YYYY-MM-DD` fija un día civil no futuro para una demostración controlada. Al aplicar, ese anchor se guarda y ya no se mueve al repetir ni al desplegar. Ningún reloj financiero supera la medianoche del anchor: los cursos futuros también tienen efectivo registrado hoy o antes, no pagos futuros ficticios. En fin de semana, el curso “actual” empieza el viernes anterior y sigue en curso hoy: no se inventa un calendario de clases de fin de semana.

## APPLY autorizado

Solo después de revisar nombres, IDs, fechas y escenarios del PLAN y aprobar el destino:

```sh
bun scripts/financial-demo.ts --target local --project local --apply
bun scripts/financial-demo.ts --target production --project fvzxqlezdrlzykyoevub --apply
```

Mantener el mismo ADMIN y anchor. La aplicación imprime el plan antes de escribir. Toda la ejecución ocurre en **una transacción**; los repositorios financieros usan savepoints. Un fallo revierte formatos/cursos/grupos/participantes, movimientos, receipts y auditorías nuevos conjuntamente. Después de una interrupción, repetir el PLAN: o no existe manifiesto/filas (rollback), o el manifiesto completo verifica hashes y el rerun es no-op. Filas parciales sin manifiesto, colisiones, edición manual o provenance inesperada abortan; no se “reparan”, sobrescriben ni borran.

## Ejemplos y preservación

- Namespace versionado `skillbase-financial-demo-v1`, UUIDs deterministas para formatos/revisiones/cursos/grupos/request keys y marcadores `DEMO_SEEDED`.
- Dos formatos nuevos propios de 20 h/90 min (pagado Bs 80/100, gratuito Bs 0/0); cuatro cursos publicados nuevos: pasado, actual, futuro y taller abierto futuro; ocho grupos con cupo 20 y horarios 12:00–13:30 / 14:00–15:30. El gate existente comprueba conflictos instructor y duración/calendario antes de commit.
- Once fichas sin Auth, CI ficticio alfanumérico que conserva ceros, emails `example.test`: pago completo/parcial pasado y actual; futuro completo/parcial, cancelación con deuda de devolución, cancelación con devolución positiva registrada, transferencia entre grupos del mismo curso y saldo completado mediante abono adicional; gratuito sin pago cero.
- Con mínimo default 25 %, parcial Bs 20 sobre Bs 80. Se respeta el mínimo vigente sin cambiar settings; si es 100 %, el runner aborta porque no puede mostrar un parcial válido. Descuentos globales, revisiones anteriores y snapshots no se recalculan.
- Altas, efectivo, cancelaciones, devolución y transferencia pasan por casos de uso y repositorios existentes. Solo los fixtures administrativos usan un reloj previo a la ventana/cutoff para representar operaciones históricas válidas; no se agrega un bypass HTTP/público. Los timestamps/fechas financieras quedan históricos y auditados como demo.
- Se preservan todos los datos previos, Auth/ADMIN/sesiones/roles/perfiles, Storage, SMTP, secretos, settings y ledger de migraciones. Nunca deshabilitar triggers, hacer truncate/reset ni borrar historia para ejecutar este runner.

El manifiesto guarda anchor, hashes y `FinancialDemoContext` con IDs reales de registros retornados por receipts (no intenta imponer UUIDs a la aplicación). El contexto exportado en `financial-demo-plan.ts` incluye agrupación estable de cursos/grupos para una extensión posterior de Fase 6; este runner no escribe sesiones/asistencia/evaluación ni adivina contratos futuros. La verificación actual aborta si se cambian sus filas financieras/cursos/grupos; una futura extensión deberá preservar esa provenance y distinguir sus propias filas.

## Pruebas dirigidas

```sh
bun test tests/unit/financial-demo-plan.test.ts
bun scripts/test-financial-demo.ts
```

La segunda orden crea/migra/elimina exclusivamente un Supabase temporal propio mediante `test-stack.ts`, nunca el stack canónico ni cloud. Prueba PLAN sin escrituras, identidad/colisión, resultados/saldos, cero cash gratuito, receipts y ledger sin duplicados, anchor persistente, settings preservados y rechazo de edición manual. El lector Auth se inyecta con IDs sintéticos internos: no acredita credenciales cloud ni envío de correo. Esta prueba dirigida es independiente de la suite general y debe incluirse explícitamente en el gate combinado del release.
