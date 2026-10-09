# CERTIFICATES

## OBJETIVO

Definir el ciclo de vida de certificados digitales verificables.

El alcance aprobado, elegibilidad, plantillas, fuentes congeladas, permisos y
pendientes de implementación están detallados en
[`CERTIFICATES_CONTRACT.md`](CERTIFICATES_CONTRACT.md). Este documento conserva
los principios generales; no implica que el módulo Fase 9 ya exista.

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

El contrato aprobado distingue certificados individuales de aprobación y de
instructor. El acceso público al PDF escaneado firmado y la política ante
reapertura/re-cierre están resueltos: el archivo es privado y la reapertura no
revoca automáticamente certificados emitidos. Ver reglas completas en el
contrato; «artefacto autoritativo descargable» se limita a actores autorizados.
