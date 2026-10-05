# Demo financiero append-only (Fase 5)

Herramienta manual independiente: `scripts/financial-demo.ts`. **No se ejecuta en deploy**, no sustituye `renew-demo.ts` (que permanece local-only), no migra ni resetea bases. El usuario autorizó la carga demo de producción después del release y gate combinado; aún no se ejecutó en cloud/producción. El APPLY local fue confirmado explícitamente después de integrar el código; el estado observado está acotado abajo.

Estado: runner integrado en `development` (`6813a4c`); migraciones 0018/0019 aplicadas al local canónico (ledger 20), preservando 53 tablas previas. PLAN inspecciona destino/proyecto/provenance sin escribir. APPLY local confirmado, append-only: añadió 5 cursos, 10 grupos, 15 registros, 12 movimientos financieros, 28 sesiones, 16 marcas de participante y 4 marcas de instructor. Los totales actuales son 12 cursos, 23 grupos, 16 registros y 13 movimientos; incluyen registros previos preservados. Auth, perfiles, roles, sesiones, settings, Storage e historial financiero previo quedaron intactos. Cloud permanece en ledger 18 y no recibió seed.

La muestra verifica pagos completos/parciales y registros gratuitos sin movimiento cero; saldo pendiente de devolución y devolución registrada; transferencia entre grupos y abono adicional. Para asistencia comprueba Presente/Ausente/Justificada, N=3 (aviso al llegar a 3; inelegibilidad a partir de 4 consecutivas), revisión histórica pendiente y roster explícito, sesión de hoy aún sin marca, cancelación y reemplazos de 90 minutos. No altera el código fuente de `6813a4c`; el gate combinado final continúa pendiente.

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

### Operador manual protegido en GitHub

Cuando Vercel devuelve `[SENSITIVE]`, no intentar exportar secretos ni rotar la contraseña como atajo. `.github/workflows/production-demo.yml` usa el secreto existente `production.MIGRATION_DATABASE_URL` **in-place**, junto con `production.DEMO_SUPABASE_SERVICE_ROLE_KEY` y la variable `production.DEMO_ADMIN_ID` del ADMIN existente verificado. La clave servidor se obtiene legítimamente del owner API de Supabase y se guarda cifrada mediante stdin, nunca en Git/logs/artifacts. No se crea una cuenta ni se cambia la identidad del actor.

El workflow solo admite `workflow_dispatch` sobre `master` del repositorio canónico, hace checkout del SHA exacto y respeta el environment `production`. No hay triggers push/PR/schedule ni ejecución en deploy; permisos `contents: read`, concurrencia única con `cancel-in-progress: false`. Las credenciales solo se entregan al paso operador, no a la instalación. La opción CLI `--approved-production-operator` verifica evento, repositorio, ref y workflow/SHA exactos; CI ordinaria, PRs, Vercel y targets alternativos siguen rechazados. No se fuerza `CI=false` ni se debilitan guards de datos/provenance.

```sh
gh workflow run production-demo.yml --ref master -f mode=plan
# Revisar el PLAN completado antes de la única aplicación aprobada.
gh workflow run production-demo.yml --ref master -f mode=apply
```

`plan` es el default y READ ONLY. Ambos modos fijan proyecto `fvzxqlezdrlzykyoevub`, destino producción y extensión `--attendance`. APPLY sigue usando los mismos casos de uso, transacción atómica y manifiestos append-only; una falla no autoriza reset ni reintento ciego. Verificar después mediante lecturas y un nuevo PLAN; no volver a APPLY solo para comprobar idempotencia.

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

El manifiesto guarda anchor, hashes y `FinancialDemoContext` con IDs reales de registros retornados por receipts (no intenta imponer UUIDs a la aplicación). El contexto exportado en `financial-demo-plan.ts` incluye agrupación estable de cursos/grupos. Sin `--attendance`, el runner sigue siendo exclusivamente financiero. La extensión opcional de Fase 6 usa su namespace/manifiesto independiente y los contratos reales de `docs/ATTENDANCE_CONTRACT.md`; no escribe evaluación ni certificación. La verificación aborta si se cambian sus filas financieras/cursos/grupos y nunca repara ni sobrescribe evidencia manual.

## Pruebas dirigidas

```sh
bun test tests/unit/financial-demo-plan.test.ts
bun scripts/test-financial-demo.ts
```

La segunda orden crea/migra/elimina exclusivamente un Supabase temporal propio mediante `test-stack.ts`, nunca el stack canónico ni cloud. Prueba PLAN sin escrituras, identidad/colisión, resultados/saldos, cero cash gratuito, receipts y ledger sin duplicados, anchor persistente, settings preservados y rechazo de edición manual. El lector Auth se inyecta con IDs sintéticos internos: no acredita credenciales cloud ni envío de correo. Esta prueba dirigida es independiente de la suite general y debe incluirse explícitamente en el gate combinado del release.

## Extensión opcional de sesiones/asistencia (Fase 6)

Requiere además **0019 aplicada por el flujo estándar**. El runner no instala migraciones, inicia jobs, cambia N ni amplía ninguna allowlist de reset. `ATTENDANCE_DEMO_TABLES` en `scripts/attendance-demo-plan.ts` enumera explícitamente las seis tablas 0019 que inspecciona: settings, sesiones, roster, marcas de participante, marcas de instructor y receipts. Es inventario de capacidades, **no autorización de borrar/truncar**. Los guards financieros de `renew-demo.ts` permanecen intactos.

Con las mismas variables privadas/destinos y coordinación de release/gates ya aprobada:

```sh
# Solo lectura: plan financiero + plan de asistencia.
bun scripts/financial-demo.ts --target local --project local --attendance
bun scripts/financial-demo.ts --target production --project fvzxqlezdrlzykyoevub --attendance

# Aplicación manual explícita, después de revisar ambos planes.
bun scripts/financial-demo.ts --target local --project local --attendance --apply
bun scripts/financial-demo.ts --target production --project fvzxqlezdrlzykyoevub --attendance --apply
```

La extensión se puede aplicar junto con la primera carga financiera o después de una carga financiera existente verificada. En la primera carga se imprimen ambos planes antes de insertar fixtures; en ambos casos comparten la transacción externa del runner financiero. PLAN nunca llama al loader de asistencia que materializa calendarios: usa consultas directas READ ONLY y el planificador de dominio. Colisiones sin manifiesto, datos editados, actor/parent context diferente o N cambiado abortan. Un fallo intermedio revierte todos los fixtures nuevos, incluidos savepoints de casos de uso; no hay adopción, reparación, borrado de historia ni replay de efectivo.

Namespace `skillbase-attendance-demo-v1`, vinculado al hash de `FinancialDemoContext` y al mismo anchor/ADMIN. Añade **un curso gratuito propio**, un formato propio de sesiones de 90 min y dos grupos 06:00–07:30 / 07:30–09:00, sin alterar los cuatro cursos originales ni sus snapshots. La cohorte adicional es necesaria para mostrar simultáneamente N y N+1 con participantes realmente `INSCRITO`, sin convertir un parcial financiero en inscrito ni retroeditar pagos. Cuatro fichas sintéticas sin Auth (`present`, `warning`, `flag`, `justified`) se crean mediante `createRegistration` con tarifa propia cero y sin ningún movimiento de efectivo. Por tanto, con N default 3, la carga conjunta suma cinco cursos, diez grupos y quince registros, pero conserva los doce movimientos ficticios de Fase 5 sin añadir cash.

- Calendarios generados exclusivamente mediante `getAttendanceGroup`/`DrizzleAttendanceRepository`: 13 encuentros completos por grupo con N=3. IDs de sesiones/reemplazos generados por el backend se guardan en el contexto, no se inventan ni reescriben fechas originales.
- Se revisan explícitamente los primeros N+1 días pasados con roster elegible completo y evidencia manual: presente, ausencia, justificada, aviso al llegar a N y pérdida académica al superar N. PRESENT/EXCUSED interrumpen rachas. Con N default 3, el instructor figura justificado el primer día, ausente los siguientes dos y presente el cuarto, con actor ADMIN auditable; no se inventan porcentajes ni elegibilidad del instructor.
- Otra sesión pasada conserva revisión administrativa pendiente, sin roster retroactivo ni ausencia fabricada. Una sesión de hoy mantiene participantes sin marcar en `PENDING`, aunque la hora de clase ya haya terminado.
- `replaceAttendanceSession` cancela una original futura y crea recuperación hoy a las 04:00 (anterior al reloj controlado de las 12:00), sin conflicto de grupo/instructor. Otra recuperación cae el siguiente sábado a las 04:00. Ambas conservan duración de 90 min y vínculo a su original; una tercera original futura se cancela mediante `cancelAttendanceSession`. No hay clases independientes añadidas ni cambios de fin oficial.
- Si el anchor cae en fin de semana, la recuperación de hoy proporciona la sesión pendiente de ese día sin inventar clases L–V de fin de semana. Fechas, IDs, roster y marcas permanecen históricos en reruns; no se desplazan al “hoy” de un nuevo deploy.
- El formato amplía únicamente la **nueva** cohorte cuando N exige más encuentros (mínimo 13; suficiente para N+1 revisados, revisión pendiente y recuperaciones). N debe estar entre 1 y 994 por el límite existente de 1000 sesiones del planificador. Fuera de ese rango se aborta, sin cambiar settings ni fabricar horas/asistencia. Si cambia N o se registra nueva evidencia manual/materializada después del seed, el rerun conservador detecta cambio y aborta; no restaura la demostración encima del trabajo del operador.

API del seed: `runAttendanceDemo(tx, actor, financialContext, apply, preview?)` en `scripts/attendance-demo.ts`, llamada dentro de la transacción de operador ya verificada del runner financiero. Devuelve `AttendanceDemoContext` (o `null` en PLAN sin manifiesto), exportado desde `scripts/attendance-demo-plan.ts`:

- `owner`, `anchorDay`, `consecutiveAbsenceLimit`, `financialContextHash`;
- `courseId`, `groupIds`, `registrations` con claves `present`, `warning`, `flag`, `justified`;
- `sessions`: `original:1..sessionCount`, `recorded`, `reviewPending`, `todayPending`, `cancelled`, `cancelledOriginal:today`, `replacement:today`, `cancelledOriginal:weekend`, `replacement:weekend`.

El contexto real también queda en el manifiesto privado `DEMO_SEEDED` de asistencia. No se exponen CI, contactos o finanzas al instructor ni se modifica el contrato de UI. Para los fixtures/validación posterior, usar estos IDs reales y no contar filas o asumir IDs aleatorios del backend.

Pruebas dirigidas de esta extensión:

```sh
bun test tests/unit/attendance-demo-plan.test.ts tests/unit/financial-demo-plan.test.ts
bun scripts/test-attendance-demo.ts
```

La integración dirigida usa únicamente su Supabase temporal propio, aplica 0018/0019 allí y comprueba PLAN sin escrituras, cuarentena de CI ajeno, rollback intermedio, estados/rachas reales, recuperación/cancelación/duración, idempotencia, cash/settings/usuarios/perfiles preservados y rechazo de replay tras una corrección administrativa. No crea identidades Auth, envía correo ni accede a puertos canónicos/cloud. Esta suite temporal es distinta del APPLY local confirmado arriba. El gate combinado completo queda para el cierre coordinado con UI; no se ejecutó carga productiva.
