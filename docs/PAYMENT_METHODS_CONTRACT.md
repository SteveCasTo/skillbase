# Métodos de pagos y devoluciones

## Contrato de aplicación y reportes

- `PaymentMethod = "CASH" | "QR"` en `domain/pre-registrations/types.ts`.
- Cada `CashInput` requiere `paymentMethod`, también `initialPayment`,
  `recordPayment`, `recordRefund` y una devolución inmediata de cancelación.
- El formulario HTTP plano envía `paymentMethod` con esos mismos códigos;
  dominio, aplicación y repositorio validan el valor en servidor. No hay default
  silencioso ni inferencia a partir de fecha/motivo. Gratuidad conserva
  `initialPayment: null` y no solicita método ni registra un pago cero.
- `LedgerEntryDto.paymentMethod` es `PaymentMethod | null`; `null` se presenta
  como **No registrado**, `CASH` como **Efectivo**, `QR` como **QR**. El campo es
  por movimiento, no por persona/inscripción. Una devolución puede usar otro
  método que el pago original.
- Persistencia: `registration_ledger.payment_method`, texto nullable con CHECK
  de códigos cerrados. Migración forward-only `0028_payment_methods.sql` deja
  nulos los históricos; trigger INSERT rechaza nuevos movimientos sin método.
  No se reescriben migraciones previas. Base inicial origin/development y
  origin/master: 0000–0026, journal idx 26/27 entradas. PR384 integró
  `0027_interest_operational_cleanup` en development como `879a082`.
  La cadena de pagos incorpora 0027 sin modificarla y enlaza el snapshot de
  0028 con ella: idx 28, journal resultante de 29 entradas. No se inventó una
  migración vacía ni se confundió el contador con el prefijo del archivo.
- Append-only, montos, mínimos, estados, permisos, revisiones e idempotencia
  permanecen. El método forma parte del fingerprint canónico: cambiarlo con la
  misma clave de solicitud genera `IDEMPOTENCY_CONFLICT`. Los receipts previos
  permanecen inmutables; un replay de respuesta histórica puede carecer del
  campo, por lo que presentación debe tolerarlo como dato no registrado.
- Contrato para el futuro exportador: leer el campo del DTO/consulta privada
  autorizada y aplicar las tres etiquetas anteriores. No sumar QR aparte del
  ledger existente ni alterar signos/cálculos. Este PR **no modifica** CSV/PDF
  financiero ni snapshots/exportes de cierre académico. Instructor continúa sin
  acceso a finanzas.

## Seed replayable y enriquecimiento de datos de prueba

Los runners financiero y comprehensive incluyen método en cada movimiento nuevo:
primer pago Efectivo, abonos/devoluciones QR. Sus marcadores y fingerprints del
plan no cambian. Un replay ya completado devuelve su contexto, sin volver a
ejecutar comandos monetarios antiguos con un payload diferente.

`scripts/seed-payment-methods.ts` es una operación **separada**, manual y acotada;
no forma parte de migraciones/deploy y no ejecuta reset ni reseed. PLAN abre una
transacción read-only; escribe únicamente un manifiesto privado fuera del repo,
con UUIDs/hashes y conteos PAYMENT/REFUND, métodos y faltantes. No guarda CI/email
en claro en el manifiesto ni imprime conexiones/credenciales. Los métodos ya
registrados se conservan; para NULL usa SHA-256 del UUID del movimiento (paridad
del primer byte), determinista y diverso sin relación con dinero/identidad.

Guards: destino canónico local o proyecto cloud exacto, aprobación explícita
cloud, marcador `DEMO_SEEDED` del curso con owner financiero/comprehensive y
pares CI/email sintéticos de esos seeds. Rechaza **todo el plan** si encuentra
una fila no reconocida; nunca la marca automáticamente como prueba por estar en
un entorno demo. Si hay movimientos manuales de prueba ajenos a esos owners,
el integrador debe inventariar/aprobar sus identidades en un archivo privado
fuera del repo y pasarlo al PLAN mediante `--approved-identities <ruta-absoluta>`.
El JSON es un array de objetos `{participantId, courseId, ci, email,
testDataApproved: true}` con los valores exactos existentes (sin normalización
implícita). El manifiesto retiene solo UUIDs, hash de CI/email y procedencia
`EXPLICIT_TEST`, además de contar esos movimientos aparte. APPLY revalida esas
identidades exactas desde el manifiesto revisado. No usar regex genéricas ni dar
método inventado a datos reales. La autorización de los datasets de prueba no es
autorización para etiquetar identidades desconocidas o saltar el inventario.

APPLY exige el hash revisado del manifiesto. Bajo locks verifica el conjunto
completo, identidades y hash de cada fila sin método. Exige los dos triggers
esperados activos. Deshabilita **solo** el trigger append-only del ledger dentro
de la transacción privilegiada/exclusiva, cambia únicamente NULL del método y lo
rehabilita antes del commit. Cualquier error revierte datos y estado del trigger.
No instala un bypass permanente ni altera la función append-only. Verifica que
todos los demás campos del ledger sean idénticos; no cambia receipts,
fingerprints, auditoría, revisiones, montos, cursos, certificados, Auth o settings.
Repetir APPLY con el mismo manifiesto es idempotente (`updated: 0`).

### Operación del integrador después del release (no ejecutada por este PR)

1. Integrar PRs, validar y liberar. Aplicar 0028 por el migrador Drizzle normal
   (`bun run db:migrate`) con conexión segura provista por CLI; nunca resetear.
2. En ventana exclusiva, tomar backup privado y verificar inventario/ledger y
   preservación de datos. Inyectar `MIGRATION_DATABASE_URL` (o `DATABASE_URL`) y
   `PUBLIC_SUPABASE_URL` sin imprimirlas, usando el operador CLI autorizado.
3. PLAN local, desde el checkout limpio de release:

   ```sh
   bun --no-env-file scripts/seed-payment-methods.ts --target local --project local --manifest <ruta-absoluta-privada-nueva>
   ```

   Cloud: `--target production --project fvzxqlezdrlzykyoevub --allow-production`.
   Preparar un manifiesto **distinto por entorno**. Revisar UUIDs, conteos,
   guards y hash; confirmar que el inventario completo contiene solo pruebas.

4. Mismo comando y manifiesto más `--apply --reviewed-hash <hash-PLAN>`. Repetir
   APPLY para comprobar `updated: 0`; verificar métodos, conteos, hashes del resto
   del ledger, receipts/auditoría/revisiones y triggers habilitados. Conservar
   manifiesto/backup/evidencia privados, nunca en Git.

No se ejecutaron migraciones, PLAN conectado ni APPLY contra local canónico o
cloud durante implementación. `--help` es offline y no crea conexión. Las
pruebas usan únicamente stacks QA temporales aislados. La evidencia final de
checks/CI y despliegue corresponde al integrador, no a este contrato.

### Evidencia de implementación (checkout de pagos, 2026-10-14)

- Check (lint/formato/typecheck): PASS, 0 errores/0 warnings. Build: PASS.
  `drizzle-kit check`: PASS.
- Unit global: 464/464. Integración global: 177/177. Focal repositorio/schema
  financiero: 28/28. Caso existente del seed financiero: 1/1, 42 assertions.
- E2E existentes de preinscripciones: 3/3 Chromium, puerto exclusivo 44917;
  responsive light/dark, selección Efectivo/QR, preservación tras error,
  historial, roles y gratuidad sin JS. No se añadieron casos/specs/suites ni
  cambiaron timeouts/retries.
- Las primeras corridas concurrentes tuvieron timeouts (incluidos dos PDFs
  unitarios); el E2E de la pasada posterior también agotó tiempo antes de
  completar acciones. Corridas seriales finales pasaron sin modificar límites.
  El primer intento del caso seed quedó pendiente al pasar un query thenable
  lazy de postgres directamente a `expect(...).rejects`; se convirtió a Promise
  explícita en el test y el caso final pasó. No atribuir todas las fallas a
  flakiness ni considerar evidencia de un gate cloud.
- Las tres capturas de anchos 320/768/1280 en ambos temas proceden del caso E2E
  existente. El release integrado y su CI deben revalidar la cadena de
  migraciones después de integrar 0027/PR384.
