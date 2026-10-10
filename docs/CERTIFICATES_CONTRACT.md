# Contrato de certificados (Fase 9)

## Estado y límites

El alcance de negocio de este contrato fue aprobado. La implementación de Fase 9
(dominio/aplicación, persistencia, rutas, renderer PDF/QR, UI y extensión de demo)
se liberó a `master` por PR 299 y la corrección de origen del seed por PR 301;
source final `dc55620df325c69dfce0b3661527a1049e392fe5`. La migración 0023 está
aplicada a cloud y el demo sintético se ejecutó allí por workflow protegido. La
fuente oficial F8 permanece inmutable. Evidencia y límites del release están en
[`PLAN.md`](PLAN.md), [`TESTING.md`](TESTING.md) y [`DEPLOYMENT.md`](DEPLOYMENT.md);
las reglas generales y decisiones se resumen en [`CERTIFICATES.md`](CERTIFICATES.md)
y [`DECISIONS.md`](DECISIONS.md).

El CI integrado y la QA focal de la extensión F9 están documentados en
[`TESTING.md`](TESTING.md) y [`DEMO_SEED.md`](DEMO_SEED.md). Esta evidencia no
equivale a migración cloud, release, disponibilidad de producción ni firmas
institucionales físicas/digitales.

## Tipos y elegibilidad

Se emitirán dos tipos, ambos asociados a un grupo y a la versión oficial de su
cierre:

1. **Certificado de aprobación** individual para cada participante que figure
   como `INSCRITO` en el roster de esa versión y cuyo `academicallyPassed` sea
   verdadero. Esa es la decisión académica oficial de Fase 8: resultado de nota
   aprobado **y** elegibilidad académica por asistencia. No recalcular contra
   notas, roster, umbral ni asistencia actuales.
2. **Certificado de instructor** para la persona asignada al curso al momento
   del cierre oficial del grupo. Su elegibilidad no depende de las notas ni de
   la aprobación/asistencia de estudiantes, pero sí exige un grupo actualmente
   cerrado con su última versión oficial vigente. El nombre e ID del destinatario
   proceden del snapshot del cierre (`instructorId`/`instructorName`), no de una
   asignación o perfil resueltos posteriormente.

No hay excepciones manuales ni emisión de aprobación si falta saldo, queda deuda
o existe cualquier otro estado financiero. No se añade control financiero al
flujo de certificación. La participación futura, asistencia/horas acumuladas,
certificados de participación, niveles de certificado y boleta/valorado de la
universidad física quedan fuera del alcance aprobado; la boleta no requiere una
entidad ni un requisito financiero nuevos en Fase 9.

La elegibilidad debe derivarse del cierre/versionado y la operación sensible
debe volver a validarse en servidor. ADMIN gestiona certificados. INSTRUCTOR
puede consultar en modo de solo lectura únicamente los cursos/grupos propios
con los permisos de instructor ya existentes; no genera, firma, carga, emite,
revoca ni reemplaza certificados.

## Fuente oficial y datos congelados

La unidad de procedencia es el grupo y su versión de cierre oficial. Para la
aprobación estudiantil, usar solo miembros `INSCRITO` presentes en el roster
congelado y el `academicallyPassed` congelado. Para el certificado del
instructor, usar la asignación capturada en esa misma versión.

En la generación, ADMIN obtiene del servidor la versión oficial autorizada y
lee las fuentes institucionales/curriculares que aún no están incluidas en ese
snapshot. Congelar en el registro de certificado y en el artefacto todos los
valores efectivamente impresos, su procedencia/versión, fechas, horas, grupo,
destinatario y firmantes/cargos, además de la versión de plantilla, branding,
logos y configuración usada. Una edición posterior de curso, grupo, instructor,
ajustes o plantilla no debe reescribir lo ya generado o emitido. Corregir los
datos del certificado exige el flujo explícito de reemplazo, conservando el
anterior y su trazabilidad; no se corrige sobrescribiendo un PDF emitido.

No modificar el snapshot ni los datos históricos de Fase 8 para suplir campos
que no conserva. El código de cierre actual conserva curso/grupo, destinatario
instructor, roster, resultados y decisión académica; no conserva como snapshot
las fechas nominales del curso, duración nominal, ubicación, horario del grupo
ni todos los valores de branding/firmantes. Las fechas de aprobación se leen de
`courses.startsAt`/`courses.endsAt`; las fechas y horario nominales de instructor
de `groups.startsAt`/`groups.endsAt`; la duración académica nominal de
`course_type_revisions.totalHours` vinculada al curso/grupo. No son valores del
snapshot F8 y deben copiarse junto con su procedencia al generar el certificado.
Verificar la fuente del resto de campos al implementar; registrar en el nuevo
certificado la copia congelada.
Si un campo obligatorio de la plantilla no puede obtenerse o validarse, no
generar un documento incompleto ni inventarlo: bloquear y mostrar el campo que
ADMIN debe completar/configurar conforme al flujo aprobado.

En el certificado de aprobación, las fechas impresas son las fechas civiles
nominales de `courses.startsAt` y `courses.endsAt`. En el de instructor se usan
las fechas/horarios civiles nominales de `groups.startsAt` y `groups.endsAt`,
formateadas como hora/fecha civil Bolivia (`America/La_Paz`) para el template;
no sustituirlas por hora de cierre, generación, emisión o reloj del sistema. En
ambos, la duración es
`course_type_revisions.totalHours` de la revisión vinculada al curso/grupo, no
la suma de asistencia efectiva, recuperaciones o sesiones individuales. La
línea de aprobación lleva `Cochabamba, [mes de finalización] [año]`; el mes
procede del fin nominal del curso, nunca de generación/emisión. La ubicación y
denominación institucional se conservan literalmente como en la referencia
(Laboratorio de Cómputo, Departamento de Informática y Sistemas, FCyT; ciudad
Cochabamba en la línea de fecha). Capturar estos valores y la versión de
configuración/branding en la metadata del certificado.

La etiqueta visible del grupo es un ordinal humano positivo (por ejemplo,
`GRUPO 1`, `GRUPO 2`), inicialmente por orden de creación dentro del curso
(`groups.createdAt`, con `groups.id` como desempate estable). ADMIN puede corregirlo antes de generar
el certificado; congelar entonces el valor y no recalcularlo si cambia el orden
ni alterar certificados ya generados. El horario impreso usa el horario nominal
del grupo; nunca inferir o inventar una etiqueta/horario desde asistencia o
sesión individual.

Los instantes internos del ciclo (generación, carga, emisión, revocación y
reemplazo) se guardan aparte de las fechas civiles nominales. La fecha de
verificación pública corresponde a la fecha de finalización impresa, no al
instante de emisión.

## Artefactos y plantilla institucional

Se reconstruyen dos PDFs a partir del contenido y las dimensiones de las
referencias entregadas; no se presupone ni se requiere un original editable PDF
o Word:

- **Aprobación:** Carta horizontal, 279.4 × 215.9 mm.
- **Instructor:** Carta vertical.

Conservar todo el contenido fuente, jerarquía, cajas de firma y proporciones del
diseño. La estructura puede adaptarse lo mínimo necesario para poner en el
**anverso** un QR y `publicCredentialId` discretos, sin eliminar ni sustituir
contenido, logos o espacios de firma.
El QR apunta a `https://<dominio>/certificados/<publicCredentialId>` y no lleva
PII ni otro dato del certificado codificado. No se imprime necesariamente una
URL larga.

Orden institucional y logos: UMSS → FCyT → Departamento de Informática y
Sistemas. Usar los PNG transparentes provistos, sin redibujarlos, alterar
proporciones, sustituirlos por SVG externo ni usar una captura completa de
plantilla como fondo. Las capturas contienen identidades reales: no transcribir
sus nombres/cargos personales ni reutilizarlas como assets o fixtures. Los
assets deben integrarse desde los archivos fuente autorizados, preservando sus
bytes/proporción y registrando versión/hash cuando se implementen. No afirmar
validación legal de la marca por el hecho de reproducir los archivos provistos.

### Texto de aprobación

Mantener el encabezado institucional y estas leyendas/campos, sin agregar
campos de negocio que no están en la referencia:

> CERTIFICADO<br>
> DE APROBACIÓN<br>
> OTORGADO A<br>
> [NOMBRE COMPLETO DEL ESTUDIANTE — MAYÚSCULAS Y SUBRAYADO]<br>
> Por haber completado satisfactoriamente el curso intensivo de :<br>
> [NOMBRE DEL CURSO]<br>
> Realizado en los ambientes del Laboratorio de Cómputo, Departamento de
> Informática y Sistemas de la Facultad de Ciencias y Tecnología, del [inicio]
> al [fin], con una duración de [cantidad] horas académicas.<br>
> Cochabamba, [mes de finalización] [año]

El tema visual/icono del curso es opcional y requiere un asset autorizado que se
provea posteriormente; no bloquea el documento básico y no se inventa un icono.
La ubicación y texto institucional se mantienen como en el formato fuente hasta
que una configuración aprobada los cambie.

### Texto de instructor

> CERTIFICADO<br>
> DE INSTRUCTOR/A<br>
> [NOMBRE COMPLETO DEL INSTRUCTOR — MAYÚSCULAS Y SUBRAYADO]<br>
> Por haber IMPARTIDO el curso intensivo de:<br>
> [NOMBRE DEL CURSO]<br>
> GRUPO [etiqueta de grupo], en horario de [inicio] a [fin], realizado en los
> ambientes del Laboratorio de Cómputo, Departamento de Informática y Sistemas
> de la Facultad de Ciencias y Tecnología, del [inicio] al [fin], con una
> duración de [horas] horas académicas.

No incluir en ninguno de los certificados CI, nivel, notas, asistencia detallada,
saldos, datos de contacto ni otros campos que no aparecen en el formato.

### Firmantes y cargos

Nombres y cargos de los firmantes son configurables por ADMIN en ajustes; usar
el patrón de edición inline existente (lápiz/guardar/cancelar), no un formulario
modal extenso. Congelar el valor usado para cada documento. No copiar
identidades de las imágenes fuente. Los roles/posiciones iniciales son:

| Certificado | Izquierda                                                                                   | Centro                             | Derecha                |
| ----------- | ------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------- |
| Aprobación  | Nombre instructor snapshot; cargo `INSTRUCTOR / DPTO. INFORMÁTICA-SISTEMAS`                 | `DIRECTOR ACADÉMICO / FCyT - UMSS` | `DECANO / FCyT - UMSS` |
| Instructor  | Jefe Departamento (nombre configurable); cargo `JEFE DEPARTAMENTO / INFORMÁTICA Y SISTEMAS` | `DIRECTOR ACADÉMICO / FCyT - UMSS` | `DECANO / FCyT - UMSS` |

Los nombres de las posiciones configurables empiezan vacíos y bloquean la
generación hasta que ADMIN los configure con nombres reales; en demo únicamente
se aceptan nombres claramente marcados como ficticios. Los cargos
predeterminados anteriores también permanecen editables. No dejar un nombre
personal supuesto como valor productivo. La firma izquierda del certificado de
aprobación usa el nombre del instructor destinatario del snapshot, no otro nombre
configurable. En el certificado de instructor, la firma izquierda es el Jefe de
Departamento con nombre configurable. No truncar nombres ni apellidos: adaptar
el tamaño/ajuste del contenido para que el nombre completo y el espacio de firma
se conserven.

El nombre del destinatario y el `instructorName` usado como firmante de
aprobación deben estar presentes en la versión F8. Si el snapshot no tiene
instructor asignado/nombre válido, bloquear el certificado que depende de ese
dato; no resolver al instructor vigente ni sustituir el nombre.

## Gestión y ciclo de vida

ADMIN puede generar el PDF, imprimirlo para obtener firmas manuscritas, cargar
el PDF final firmado/escaneado, emitirlo, y posteriormente revocarlo o
reemplazarlo. La carga/emisión no se concede al instructor. Conservar historial
y artefactos previos con relación entre el certificado reemplazado y su
sustituto; revocación exige fecha, motivo y actor responsable. No borrar registros
ni archivos históricos como mecanismo de corrección. La operación de carga debe
validarse server-side según la política general de archivos en
[`SECURITY.md`](SECURITY.md); el bucket/entrega del PDF final es privado. ADMIN
e INSTRUCTOR activo pueden descargar un certificado propio/permitido mediante
una operación autenticada server-side. En INSTRUCTOR, validar `instructorId` del
snapshot del certificado, aunque la asignación actual del curso haya cambiado.
Nunca exponer URL Storage pública ni credencial `service_role`.

El `publicCredentialId` debe ser impredecible y no secuencial, separado del ID
interno. La autoridad de verificación es el registro actual de la aplicación,
no el QR, el texto del PDF ni una URL pública de Storage. Calcular y guardar
SHA-256 sobre los bytes exactos del PDF final firmado; comparar hashes de bytes
completos, sin normalizar/re-renderizar el archivo.

## Verificación pública y privacidad

La página pública de verificación recibe el identificador impredecible y consulta
el registro autoritativo actual. Presenta claramente estado vigente, revocado o
reemplazado. Su DTO de allowlist contiene únicamente estado,
nombre real del titular, tipo, curso, horas nominales, fecha de finalización,
`publicCredentialId`/URL y el hash oficial necesario para comparar bytes. No
exponer CI, email, teléfono, notas, asistencia/participación parcial, finanzas,
campos administrativos, snapshots de cierre, rutas Storage ni datos ajenos al
allowlist. Sin búsqueda por nombre/CI/correo ni consulta directa de DB desde el
navegador. Aplicar límites contra enumeración con respuestas que no filtren si
IDs cercanos existen.

El PDF firmado/escaneado y Storage son privados: nunca descarga anónima, URL
pública permanente, Storage path expuesto ni `service_role` al cliente. ADMIN y
INSTRUCTOR pueden descargarlo solo tras sesión/rol/ownership server-side; para
instructor el ownership es el destinatario ID del snapshot del certificado, aun
si cambió la asignación actual.

El titular puede escoger el PDF en su dispositivo y calcular SHA-256 localmente
en el navegador para compararlo con el hash oficial. No subir los bytes ni
persistir el archivo aportado. Una coincidencia confirma que los bytes son
idénticos al artefacto emitido, no que el portador sea titular ni que no existan
copias. Una alteración del documento cambia su hash. La firma manuscrita
escaneada es una atestación administrativa, **no** una firma digital
criptográfica. El usuario debe comparar el titular/certificado mostrado con el
documento; un QR copiado enlaza al registro indicado, no convierte otra hoja en
auténtica.

Para LinkedIn ofrecer copiar/compartir URL, ID, nombre real del titular,
organización, curso y fecha; no foto/imagen de identidad ni integración API u
OAuth. El QR incluye solo la URL pública y no requiere imprimir la URL larga.
Si un código corresponde a un registro todavía no emitido (`pending`, `generated`
o `awaiting_signature`), no presentarlo como credencial válida ni mostrar datos
adicionales. La validez positiva corresponde a registro `issued` vigente, no
revocado ni reemplazado.

## Reapertura, versiones y reemplazo

Generación y emisión solo se permiten cuando el grupo está cerrado y la versión
objetivo es la última versión oficial actual. La reapertura bloquea nuevas
generaciones/emisiones; borradores de la versión previa quedan obsoletos. Tras
el nuevo cierre, regenerar desde la última versión oficial. Nunca emitir desde
una versión antigua ni una versión provisional.

La reapertura **no revoca automáticamente** certificados ya emitidos: siguen
válidos hasta una revocación/reemplazo explícito de ADMIN. No modificar el
snapshot de cierre ni el certificado emitido. Mantener como máximo un
certificado activo por curso/tipo/destinatario; el reemplazo marca el previo
`replaced`, lo enlaza al nuevo y conserva ambos registros y artefactos.

## Implementación y límites de estado

La migración 0023 (journal `idx: 23`, SHA-256
`4c78ed1735b0cd3cb34d2bdc5f1f2c0d15b51dcc31568136839d706649489ee1`, timestamp
`1791500766703`) se aplicó a cloud y el ledger quedó en 24. El ordinal de grupo es
ADMIN-editable antes de generar; sus ajustes, ubicación/leyendas institucionales,
branding y assets autorizados se congelan en la configuración/procedencia del
certificado. Los snapshots F8 no se modifican.

No quedan abiertas decisiones de negocio dentro del contrato aprobado sobre
tipo/elegibilidad, finanzas, firmantes, QR, exposición de la verificación,
privacidad del PDF, reapertura, vigencia de emitidos ni reemplazo. La migración,
release y demo cloud protegida están completados. Evidencia cloud: ocho páginas
públicas devolvieron 200, el acceso anónimo al PDF privado devolvió 303 y
coincidieron hashes de metadata pública; no se descargaron bytes privados para
un cotejo independiente del PDF cloud. No se afirma firma física ni validez
institucional. En la demo local post-reset se verificaron ocho páginas públicas
y los bytes/hash SHA-256 más sello DEMO de seis PDFs finales privados; el estado
de login autenticado sigue pendiente. Las correcciones UI/funcionales de F9 no
constituyen un alcance aprobado por defecto: quedan en espera hasta que el
usuario indique posteriormente qué secciones/defectos desea corregir. La
operación protegida de seed se rige por [`DEMO_SEED.md`](DEMO_SEED.md).
