# CERTIFICATES

## OBJETIVO

Definir el ciclo de vida de certificados digitales verificables.

El alcance aprobado, elegibilidad, plantillas, fuentes congeladas y permisos
están detallados en
[`CERTIFICATES_CONTRACT.md`](CERTIFICATES_CONTRACT.md). Este documento conserva
los principios generales. El módulo está integrado en `development`; esto no
implica release a producción.

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
- tipo de certificado;
- fecha;
- credential ID.

La página pública incluye estado, titular, curso, horas nominales, fecha final,
ID/URL y el hash oficial para comparación local de bytes. La allowlist concreta
para Fase 9, que no incluye nivel no impreso en la plantilla, está en
[`CERTIFICATES_CONTRACT.md`](CERTIFICATES_CONTRACT.md).

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

## IMPLEMENTACIÓN Y RELEASE

La interfaz conectada al backend disponible en esta rama incluye:

- Administración de certificados en `/app/certificados`, ajustes en `/app/configuracion/certificados` y acceso a certificados del grupo desde las vistas ADMIN e INSTRUCTOR.
- Detalle privado ADMIN y detalle histórico readonly del instructor en `/app/mis-certificados/[certificateId]`; descargas PDF privadas usan rutas autenticadas.
- Generación, revisión/carga del archivo firmado, emisión y revocación mediante las operaciones server-side existentes. Los formularios SSR conservan los errores y valores recuperables; la autorización y las transiciones las decide el servidor.
- Página pública `/certificados/[publicCredentialId]` y formulario de búsqueda en `/certificados`. La respuesta pública es una proyección mínima; no expone snapshots privados ni ofrece descarga anónima del PDF.
- Verificación local opcional del archivo seleccionado: SHA-256 se calcula en el navegador, sobre el archivo local. El contenido no se transmite para calcular ese hash; no equivale a una firma digital ni demuestra por sí solo la identidad de quien lo presenta.

Fase 9 está liberada en `master` como `dc55620df325c69dfce0b3661527a1049e392fe5` y desplegada en `https://skillbase-alpha.vercel.app`; migración cloud en ledger 24. La demo cloud contiene ocho registros sintéticos y sus páginas públicas verificadas. Se comprobó metadata/hash público; un PDF privado anónimo devolvió 303, pero no se descargaron bytes privados para comparación SHA-256 independiente. La demo local reconstruida tiene ocho certificados y páginas públicas verificadas; seis PDFs finales privados se descargaron/protegieron y sus bytes/hash SHA-256 y sello DEMO se verificaron. Esto no prueba firma institucional real o manuscrita. Las capacidades ausentes del contrato backend (por ejemplo, índice global de historial de instructores o enlace público de reemplazo) no se simulan en la UI. Las correcciones UI/funcionales quedan en espera de una indicación posterior y no se inventan desde esta documentación. Ver progreso y límites de validación en [`PLAN.md`](PLAN.md), [`TESTING.md`](TESTING.md) y [`DEPLOYMENT.md`](DEPLOYMENT.md).

La carga/revisión manual de un PDF no verifica criptográficamente una firma manuscrita. Los archivos sintéticos usados en QA solo prueban el ciclo técnico; no son certificados institucionales firmados ni evidencia de autoridad legal.

El alcance aprobado distingue certificado individual de aprobación y certificado
de instructor. El PDF final/escaneado permanece privado y solo se descarga por
operaciones autenticadas con autorización de rol/ownership; la reapertura no
revoca certificados emitidos automáticamente. El artefacto autoritativo se limita
a actores autorizados. Las reglas aprobadas de elegibilidad, snapshots, ciclo de
vida, privacidad y verificación están en [`CERTIFICATES_CONTRACT.md`](CERTIFICATES_CONTRACT.md)
y [`DECISIONS.md`](DECISIONS.md).
