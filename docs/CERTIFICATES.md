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

La página pública incluye estado, titular, curso, horas nominales y fecha final;
omite las filas del código de credencial y del SHA-256 oficial. El identificador
público permanece en la URL, el QR, el PDF y la búsqueda manual; no se oculta ni
se sustituye por el hash. El hash oficial sigue en los metadatos de comparación
del navegador y en el contrato público, no como texto visible. La allowlist concreta
para Fase 9, que no incluye nivel no impreso en la plantilla, está en
[`CERTIFICATES_CONTRACT.md`](CERTIFICATES_CONTRACT.md).

No mostrar:

- CI;
- teléfono;
- email;
- calificaciones parciales;
- asistencia detallada.

### Presentación del verificador público

La landing ofrece un único botón hacia `/certificados/verificar`, con dos entradas:
código de 32 caracteres o PDF firmado. `/certificados` conserva compatibilidad y
redirige a esa página; la consulta HTML por código sigue llevando a la URL del QR.
Con JavaScript, ambas entradas presentan el mismo resultado sin abandonar la
página. El método primario queda ligado a ese certificado: código (también QR y
URL canónica) deja únicamente el PDF como comparación; PDF identificado sustituye
completamente sus controles por el código. No hay desplegable ni formulario extra.

La página dedicada y el resultado público aprovechan el contenedor de `CourseShell`
(máximo 86 rem), sin columnas exteriores estrechas adicionales; sus márgenes
compactos coinciden con la landing sin cambiar otras páginas públicas. El resultado
presenta el estado como título sobre dos columnas equivalentes. En desktop, la
tarjeta de datos y la zona vacía de archivo comparten altura y bordes superior e
inferior; en mobile se apilan sin forzar altura. «Comprobar tu archivo» conserva
solo su encabezado accesible. Archivo seleccionado y resultado siguen compactos.
Los errores de consulta y los resultados de comparación permanecen visibles
inline; una Promise real de Sileo complementa la lectura local y el SHA-256.
Solo la coincidencia vigente termina en éxito; coincidencia revocada/reemplazada
y archivo distinto terminan en error, nunca en una confirmación verde. Quitar o
cambiar archivo cancela el aviso pendiente sin reutilizar su resultado.
El código complementario se compara con el ID del mismo PDF; un código distinto
muestra discrepancia sin consultar ni sustituir el certificado original. Un código
coincidente reconsulta únicamente ese registro para refrescar estado/hash. Solo se
conserva la huella en memoria, no el PDF; recargar su URL canónica vuelve al flujo
por código. Quitar el archivo complementario conserva el registro. La consulta
por código funciona sin JavaScript; el archivo requiere WebCrypto.
El botón de consulta fuera de la landing conserva el fondo primario y usa el
token `deep` del shell público para el texto, en lugar de blanco sobre coral,
para mantener contraste AA sin cambiar tokens globales ni la variante landing.
El selector público admite teclado y arrastre, muestra el nombre del archivo
y ofrece «Quitar archivo» solo tras seleccionarlo. La zona de arrastre y el
archivo seleccionado son mutuamente excluyentes; quitarlo limpia también el
resultado y devuelve el foco al selector.
El resultado público presenta únicamente el mensaje de comparación con un icono
de estado, sin mostrar ni anunciar el hash calculado. Coincidencia vigente,
coincidencia con credencial revocada/reemplazada y archivo distinto se distinguen
por mensaje e icono; una coincidencia inválida nunca se presenta como éxito.
La selección nueva o «Quitar archivo» limpia el resultado anterior y conserva
la protección contra lecturas locales fuera de orden. Los hashes visibles de
ADMIN no cambian.
La comprobación conserva MIME/extensión PDF, límite de 10 MiB y SHA-256 de todos
los bytes en el navegador: no transmite ni persiste el archivo ni habilita una
descarga pública. Una coincidencia no cambia el estado oficial de la credencial.

Ambos métodos complementarios reconsultan el mismo ID público con `no-store`
dentro de la Promise real antes de comparar la huella local. No se acepta el hash
ni el estado almacenados al abrir la página como autoridad de una comparación
nueva: una sustitución rechaza el PDF anterior y una revocación actualiza el título
y devuelve no válido, nunca éxito. Un fallo HTTP, payload inválido, ID distinto o
registro no disponible impide confirmar coincidencia; no se vuelve al dato cacheado.

La entrada solo por PDF calcula la huella de todos sus bytes localmente y envía
únicamente `{sha256}` a `POST /certificados/verificar-archivo`. El servidor busca
el hash actual del firmado, nunca un borrador ni reservas/artefactos sustituidos.
No hay subida, descarga ni persistencia del archivo. El resultado reutiliza la
misma proyección pública y estado autoritativo. Una huella inexistente o ambigua
no resuelve una credencial; una revocada permanece revocada. No hay búsquedas por
prefijo, nombre, CI, email ni UUID interno.

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
La actualización interna antes de firmar cambia el ID público e invalida el anterior. Sustituir
un firmado conserva su ID y metadata, cambia el hash del artefacto actual y deja
auditoría mínima. La limpieza del objeto previo ocurre después del commit.

### Descarga y guardado del documento firmado

La descarga aparece en el encabezado del detalle. ADMIN solo dispone de
«Descargar para firmar»: su POST prepara internamente el borrador si cambió
materialmente la fuente oficial. Abrir/refrescar el detalle y los GET PDF no
regeneran. La comparación usa el snapshot efectivo (autoridades utilizadas,
fechas nominales impresas, horas, contenido institucional y versiones de
plantilla/branding), no el número de revisión de un ajuste no utilizado ni el
reloj. Un cierre oficial nuevo también invalida el borrador anterior, siempre
que el destinatario siga siendo elegible. Los assets continúan ligados a su
versión de branding inmutable; no se introducen assets ni hashes alternativos.

Sin cambios materiales se conservan ID, revisión y bytes; no hay botón de
regeneración manual. La preparación, reserva y asociación revalidan revisión y
vigencia en servidor, también si los ajustes cambian durante la carga. Un PDF
obsoleto se rechaza con una indicación de volver a descargar y tramitar firmas.
Con JavaScript se actualiza el detalle tras una preparación que cambie revisión;
sin JavaScript la descarga conserva POST/attachment y, si se actualizó, se debe
recargar el detalle antes de cargar el firmado (la revisión anterior se deniega).

La zona de arrastre ADMIN ocupa todo el ancho del contenido, sin panel explicativo.
Su altura mínima se reduce moderadamente de 15 rem a 12.5 rem, manteniendo diseño,
icono, texto y padding; este ajuste no se aplica al verificador público.
Seleccionar o arrastrar un PDF la sustituye por el archivo y su X; una vez validado
aparece «Guardar PDF firmado» o «Sustituir PDF firmado» a su lado (apilado en mobile).
Quitarlo limpia selección/errores y devuelve la zona y el foco al selector.
El envío explícito de ese
botón (`intent=save-signed-pdf`) constituye la confirmación ADMIN, sin checkbox
ni confirmación oculta preaceptada. Servidor exige la intención, rol vigente,
revisión, finalidad SIGNED y validación de extensión/MIME/tamaño/contenido PDF.
Publicación, hash, atestación y auditoría se confirman en la misma transacción.
La selección cliente no marca el certificado como firmado ni acredita firmas
institucionales. Sin JavaScript se conservan selector HTML, required y POST;
la validación completa de contenido sigue siendo del servidor.

Un firmado nunca se actualiza automáticamente. Solo ofrece «Descargar firmado»;
la descarga unsigned también se deniega por URL directa. Sustituir exige un
nuevo archivo y mantiene ID/metadata. Guardar/sustituir usa una única Promise real
de Sileo hasta recibir y validar el registro firmado confirmado por el servidor
(estado, artefacto, hash y fecha de emisión). El botón conserva su texto y no
añade spinner ni progreso inline; disabled/aria-busy previenen doble envío. Los
errores permanecen junto al formulario y conservan selección para reintentar.
Las tarjetas revocadas reutilizan la grilla, superficie, padding, espaciado,
hover y foco del historial de cierres, sin ordinales ni datos técnicos nuevos.

Las descargas privadas de certificados usan una Promise real de Sileo, sin
«Preparando descarga…» debajo del botón: preparación POST o lectura GET, respuesta
PDF no redirigida, comprobación de Blob y entrega al navegador. «PDF listo.» no
afirma que el usuario haya guardado el archivo. Se bloquea el envío duplicado,
se restaura el control tras error y se mantienen POST/href sin JavaScript.

El detalle ADMIN no presenta el bloque de datos para LinkedIn ni la acción de
copiar credencial. Conserva el SHA-256 y «Consultar estado público» como enlace
con estilo de botón; la revocación permanece separada y con confirmación.

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

- Administración de certificados en `/app/certificados` lista solo cursos con al menos un grupo cuyo cierre oficial está vigente (`academicGroupStates.closed = true` y versión oficial coincidente con `lastVersion`); el detalle del listado contiene únicamente esos grupos, nunca grupos abiertos o reabiertos. La búsqueda por nombre se combina con el selector editorial: **Activos** (default: `DRAFT`/`PUBLISHED`, es decir, no archivados), **Archivados** (`ARCHIVED`) y **Todos** (unión). No se deduce antigüedad de fechas ni de la fase académica, ni se fija un número de cursos. Este default excluye explícitamente archivados que el listado anterior incluía. `status` acepta solo `ACTIVE`/`ARCHIVED`/`ALL` y rechaza otros valores con 400; sin parámetro usa `ACTIVE`. La selección/búsqueda se conserva en URL y SSR; cambiar filtro reinicia `page` si existía. La consulta de cierres es por lote, no por curso. Estos filtros de candidatos no revocan certificados emitidos ni modifican las rutas privadas históricas o la verificación pública. Los ajustes de firmantes están en `/app/configuracion#firmantes` (la ruta anterior `/app/configuracion/certificados` redirige allí), y las vistas ADMIN e INSTRUCTOR conservan el acceso a certificados del grupo.
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
