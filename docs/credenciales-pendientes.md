# Credenciales y APIs pendientes (todas gated en el usuario — el sistema funciona 100% con mocks mientras tanto)

Última actualización: 2026-07-18. Ninguna es urgente: cada una activa un adaptador ya construido y probado.

## Para facturar de verdad (SII)
1. **SimpleAPI** (proveedor DTE elegido, Task 13) — cuenta en simpleapi.cl + API key.
2. **Certificado digital** (firma electrónica del representante legal, e-certchile/otros) — se sube cifrado AES-256-GCM.
3. **CAF de folios** del SII (factura 33, boleta 39, NC 61) — se descargan del SII con el certificado.

## Para cobrar (dinero de clientes de cada empresa)
4. **MercadoPago por empresa** — cada empresa cliente conecta su access token + webhook secret en Configuración → Pagos (para tu propia empresa: tu cuenta MP).

## Para cobrar las suscripciones del SaaS (dinero para ti)
5. **MercadoPago plataforma** — cuenta MP tuya: `MP_PLATAFORMA_ACCESS_TOKEN` + secret de webhook (env del server, jamás BD).
6. **Transbank Webpay Plus** — convenio con código de comercio propio. *Ya testeable hoy* con las credenciales públicas de integración (comercio 597055555532, documentadas en .env.example).

## Para enviar correos reales
7. **Resend** — `RESEND_API_KEY` + **dominio propio verificado** (sin dominio, solo entrega a tu correo vía onboarding@resend.dev).

## Para el deploy a producción
8. **GitHub** — push del repo (~178 commits locales).
9. **Supabase producción** — proyecto + aplicar las 24 migraciones.
10. **Vercel** — 3 apps (web/erp/admin).
11. **Dominio propio** — requisito para: SSO por cookie de dominio entre apps, acceso a erp/admin en prod (hoy inaccesibles en *.vercel.app), y el dominio de Resend.

## Futuras (cuando toque)
12. **Anthropic API key** — capa IA del Contador Auditor (informes narrados, chat contable). Plan futuro ya diseñado como enchufe.
13. **Copec TCT Web Service** — requiere convenio/ser cliente TCT (contacto tct@copec.cl). Sin apuro: el import CSV de reportes TCT ya funciona.
14. **Indicadores previsionales para RRHH** (UF/UTM/topes/tasas AFP) — mindicador.cl es gratis y sin key para UF/UTM; las tasas AFP/topes se mantienen como tabla editable (sin API oficial). Se decide en el diseño de la Fase 3.
