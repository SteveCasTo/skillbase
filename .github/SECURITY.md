# Política de Seguridad

La seguridad y la integridad de la información son aspectos fundamentales en **SkillBase**, en especial respecto a la emisión de credenciales, autenticación y manejo de participantes.

---

## Versiones con Soporte de Seguridad

La política cubre la versión estable actual publicada en `master`. `development` es una rama de trabajo, no una versión estable con soporte independiente. Las versiones históricas y los tags anteriores no tienen mantenimiento de seguridad separado; usa la versión estable actual.

---

## Reporte Responsable de Vulnerabilidades

Si descubres una posible vulnerabilidad de seguridad en SkillBase, te solicitamos **no divulgarla públicamente** a través de issues o foros públicos.

Utiliza exclusivamente el [reporte privado de vulnerabilidades de GitHub](https://github.com/SteveCasTo/skillbase/security/advisories/new). También puedes acceder desde **Security > Advisories > Report a vulnerability**. No abras un issue público ni adjuntes allí pruebas de explotación.

Incluye en el reporte:

- Descripción detallada de la vulnerabilidad y vector de ataque.
- Pasos ordenados para reproducir el comportamiento.
- Prueba de concepto (PoC) o capturas si aplica.
- Evaluación del posible impacto en datos o credenciales emitidas.

Usa datos sintéticos y elimina secretos, tokens, cookies, contraseñas y datos personales de las evidencias. No adjuntes documentos firmados reales ni credenciales de acceso. Esta política no establece un plazo garantizado de respuesta o resolución.

Agradecemos tu colaboración responsable para mantener segura la plataforma.

---

## Documentación de Seguridad

Para conocer la arquitectura detallada de control de acceso, políticas RLS en PostgreSQL, validación de sesiones en servidor y tratamiento de archivos PDF firmados, consulta [`docs/SECURITY.md`](../docs/SECURITY.md).
