# Exportaciones financieras de preinscripciones

## Alcance

`GET /app/preinscripciones/exportar?format=CSV|PDF` sigue siendo exclusivo de
ADMIN activo. Es un **reporte de estado vivo**, no un snapshot, acta ni planilla
de cierre académico. No cambia los exportadores ni los contratos del cierre.

Se mantienen curso/grupo humanos, nombres y ambos apellidos, CI, categoría
Estudiante/Externo/Auxiliar, estado de pertenencia, estado financiero, precio
acordado, pagado acumulado, saldo, devuelto acumulado y pendiente por devolver.
Se añade el nombre humano actual del responsable del registro, ya disponible en
la consulta autorizada; si falta, se indica «No registrado». No se añaden correo,
teléfono, UUID de actor, motivos privados ni identificadores de trazabilidad.

## Desglose neto por preinscripción

La proyección exclusiva de exportación `RegistrationExportRow` añade:

- `cashNetCents`: pagos Efectivo menos devoluciones Efectivo;
- `qrNetCents`: pagos QR menos devoluciones QR;
- `unrecordedMethodNetCents`: pagos menos devoluciones sin método registrado;
- `receivedNetCents`: suma de los tres anteriores, igual a pagado menos devuelto.

Los métodos proceden de `LedgerEntryDto.paymentMethod`, según
[`PAYMENT_METHODS_CONTRACT.md`](PAYMENT_METHODS_CONTRACT.md). No se infieren ni
completan métodos históricos nulos. Una devolución puede usar otro método que
el pago: un subtotal por método puede ser negativo y se conserva con su signo;
el total neto sigue conciliado. Gratuidad sin movimientos muestra ceros, nunca
un pago inventado. El saldo y la deuda de devolución siguen siendo los valores
autoritativos proyectados, sin recalcular reglas de negocio en el renderer.

`listForExport` reutiliza la consulta privada existente y su ledger por lote de
página, bajo la misma transacción, gate de serialización y revalidación fresca
ADMIN existentes. La lista ordinaria no recibe estos campos adicionales. No hay lecturas
de detalle por persona ni N+1. No requiere migración propia; depende del contrato
de métodos integrado mediante PR388.

## Formatos y límites

- CSV UTF-8 con BOM, comas y CRLF, compatible con Excel. Conserva escaping,
  protección frente a fórmulas en todos los textos —también responsable— y CI
  tratado como texto para preservar ceros. Importes decimales exactos, incluidos
  subtotales negativos, sin aritmética flotante.
- PDF A4 horizontal con Noto Sans embebida existente, encabezado institucional
  textual, fecha/hora civil Bolivia, filtros y resumen global de los registros
  exportados. Usa grupos contiguos por curso/grupo, cabeceras repetidas y páginas
  numeradas. Las columnas principales muestran precio, netos y saldo; debajo de
  cada participante aparecen pagado/devuelto/por devolver y responsable. Así se
  conservan todos los datos sin comprimir nueve importes y nombres en una fila.
- Nombres y etiquetas envuelven sin elipsis; montos se alinean a la derecha sin
  cortar dígitos. Texto no soportado por la fuente o que exceda la página falla
  explícitamente y conserva la alternativa CSV. No hay firmas ni sellos ficticios.
- Los totales globales usan BigInt. Un mismo instante controla nombre de archivo
  y fecha/metadata del PDF. No se guardan archivos con PII en el servidor.
- Se exportan todas las páginas del filtro, no solo la página visible, hasta
  1000 registros en lotes de 100. Se mantienen los rechazos por total cambiante,
  filas repetidas/páginas incompletas y el límite excedido. Cada página es una
  lectura consistente; el reporte completo no afirma un snapshot transaccional
  único entre páginas concurrentes.
- Se conservan `private, no-store`, attachment y `nosniff`, filtros y autorización
  server-side. La UI de listado y su paginación no cambian en este trabajo.

## Verificación

Se adaptan exclusivamente escenarios existentes de unit, integración y E2E;
no se añaden casos, suites ni specs ni se modifican timeouts/retries. La evidencia
visual usa únicamente fixtures sintéticos offline, sin acceso a datasets de
desarrollo o producción. El handoff de la PR registra resultados de ejecución y
rutas de PDF/capturas; estos no acreditan un despliegue ni una migración aplicada
en canónico/cloud.
