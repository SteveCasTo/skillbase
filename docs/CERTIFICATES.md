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
→ confirmar y publicar atómicamente con atestación ADMIN
→ verificación pública
```

## Configuración y vista previa

ADMIN edita cada nombre, cargo o afiliación desde Configuración → Certificados
y autoridades. Cada guardado modifica solo el campo solicitado, valida la revisión
vigente y conserva la auditoría; los PDFs históricos no cambian. La ruta antigua
redirige a `#firmantes` en GET y conserva compatibilidad de POST.

Las vistas previas de aprobación e instructor usan la configuración **guardada**
y datos de curso/destinatario de muestra. El PDF se abre en un visor y presenta
el ID y QR con la misma composición que los certificados emitidos, sin texto
inferior «Vista previa» ni otra marca sustituta. El identificador de muestra
contiene un punto, fuera del alfabeto base64url de emisión, y su QR apunta a
`https://preview.invalid/certificados/<ID-de-muestra>`: no verifica una credencial
real ni utiliza el dominio oficial. El endpoint ADMIN privado
`/app/configuracion/certificados/vista-previa.pdf` responde inline y no-store:
solo lee ajustes, incluso con revisión cero; no genera registros, artefactos,
receipts, eventos ni escrituras en Storage. No añade un tipo de participación.

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

### Presentación del verificador público

`/certificados` y el resultado público aprovechan el contenedor de `CourseShell`
(máximo 86 rem), sin columnas exteriores estrechas adicionales; sus márgenes
compactos coinciden con la landing sin cambiar otras páginas públicas. El resultado
presenta el estado como título, los datos permitidos y «Comprobar tu archivo»;
los errores de consulta y los resultados de comparación permanecen visibles
inline, sin un toast duplicado.
El selector público admite teclado y arrastre, muestra el nombre del archivo
y ofrece «Quitar archivo» solo tras seleccionarlo; quitarlo limpia también el
resultado y devuelve el foco al selector. No modifica el selector privado ADMIN.
La comprobación conserva MIME/extensión PDF, límite de 10 MiB y SHA-256 de todos
los bytes en el navegador: no transmite ni persiste el archivo ni habilita una
descarga pública. Una coincidencia no cambia el estado oficial de la credencial.

## HASH

Calcular SHA-256 del PDF final.

Almacenar hash junto al certificado.

## ESTADOS

Internos (la UI presenta «Para firmar» y «Firmado»):

- pending
- generated
- issued
- revoked

## REVOCACIÓN

Nunca eliminar un certificado revocado.

Mostrar claramente:

`Certificado revocado`

Registrar:

- fecha;
- motivo;
- responsable.

## REGENERACIÓN Y SUSTITUCIÓN

Un único registro por grupo/tipo/destinatario, sin versiones/historial en UI.
Regenerar antes de firmar cambia el ID público e invalida el anterior. Sustituir
un firmado conserva su ID y metadata, cambia el hash del artefacto actual y deja
auditoría mínima. La limpieza del objeto previo ocurre después del commit.

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

- Administración de certificados en `/app/certificados` lista solo cursos con al menos un grupo cuyo cierre oficial está `CLOSED`; permite buscar esos cursos por nombre. Los ajustes de firmantes están en `/app/configuracion#firmantes` (la ruta anterior `/app/configuracion/certificados` redirige allí), y las vistas ADMIN e INSTRUCTOR conservan el acceso a certificados del grupo.
- Detalle privado ADMIN y detalle histórico readonly del instructor en `/app/mis-certificados/[certificateId]`; descargas PDF privadas usan rutas autenticadas.
- Tarjetas individuales desde elegibilidad oficial, generación explícita POST y carga de un PDF firmado con atestación ADMIN. Guardar/sustituir confirma el firmado en una sola transacción; no existen formularios independientes de revisión/emisión, selector masivo ni campo ordinal. Después de firmar, la descarga unsigned se deniega también en servidor.
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
