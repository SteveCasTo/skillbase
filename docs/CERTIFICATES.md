# CERTIFICATES

## OBJETIVO

Definir el ciclo de vida de certificados digitales verificables.

## PRINCIPIO

La autenticidad no depende del QR.

Depende del registro autoritativo del sistema.

## FLUJO

```text
grupo cerrado
→ participantes elegibles
→ generar certificado
→ imprimir / tramitar firmas
→ subir archivo firmado
→ calcular hash
→ emitir
→ verificación pública
```

## IDENTIFICADORES

Cada certificado debe tener:

- ID interno;
- publicCredentialId impredecible.

No utilizar IDs secuenciales como identificador público.

## QR

El QR apunta a:

```text
https://<dominio>/certificados/<publicCredentialId>
```

No insertar datos sensibles directamente en el QR.

## VERIFICACIÓN PÚBLICA

Mostrar únicamente:

- estado;
- participante;
- curso;
- duración;
- nivel cuando corresponda;
- tipo de certificado;
- fecha;
- credential ID.

No mostrar:

- CI;
- teléfono;
- email;
- calificaciones parciales;
- asistencia detallada.

## HASH

Calcular SHA-256 del PDF final.

Almacenar hash junto al certificado.

## ESTADOS

Iniciales:

- pending
- generated
- awaiting_signature
- issued
- revoked
- replaced

## REVOCACIÓN

Nunca eliminar un certificado revocado.

Mostrar claramente:

`Certificado revocado`

Registrar:

- fecha;
- motivo;
- responsable.

## REEMPLAZO

Un certificado reemplazado debe conservar relación con el nuevo.

## PDF

El PDF debe generarse de forma determinista en lo posible.

La versión final firmada es el artefacto autoritativo descargable.

## LINKEDIN

Proporcionar:

- nombre;
- organización;
- fecha;
- credential ID;
- credential URL.

No se requiere integración API con LinkedIn para MVP.

## SEGURIDAD

No asumir que una URL Storage pública equivale a validación.

La ruta de verificación debe consultar el registro actual del certificado.

## INTERFAZ IMPLEMENTADA (RAMA FEATURE LOCAL)

La interfaz conectada al backend disponible en esta rama incluye:

- Administración de certificados en `/app/certificados`, ajustes en `/app/configuracion/certificados` y acceso a certificados del grupo desde las vistas ADMIN e INSTRUCTOR.
- Detalle privado ADMIN y detalle histórico readonly del instructor en `/app/mis-certificados/[certificateId]`; descargas PDF privadas usan rutas autenticadas.
- Generación, revisión/carga del archivo firmado, emisión y revocación mediante las operaciones server-side existentes. Los formularios SSR conservan los errores y valores recuperables; la autorización y las transiciones las decide el servidor.
- Página pública `/certificados/[publicCredentialId]` y formulario de búsqueda en `/certificados`. La respuesta pública es una proyección mínima; no expone snapshots privados ni ofrece descarga anónima del PDF.
- Verificación local opcional del archivo seleccionado: SHA-256 se calcula en el navegador, sobre el archivo local. El contenido no se transmite para calcular ese hash; no equivale a una firma digital ni demuestra por sí solo la identidad de quien lo presenta.

Este estado acredita la interfaz en la rama local `feat/certificate-interface` (`a450987`), pendiente de push, PR, integración en `development` y gates correspondientes. No acredita disponibilidad en producción. Las capacidades ausentes del contrato backend (por ejemplo, índice global de historial de instructores o enlace público de reemplazo) no se simulan en la UI. Ver progreso y gates pendientes en [`PLAN.md`](PLAN.md) y la cobertura efectivamente ejecutada en [`TESTING.md`](TESTING.md).

La carga/revisión manual de un PDF no verifica criptográficamente una firma manuscrita. Los archivos sintéticos usados en QA solo prueban el ciclo técnico; no son certificados institucionales firmados ni evidencia de autoridad legal.
