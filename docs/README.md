# Documentación

## Operación

- [`operacion-local.md`](operacion-local.md) — mantener la página arriba con Docker, comandos, modo desarrollo vs contenedores, `host.docker.internal`.
- [`deploy.md`](deploy.md) — checklist de deploy a producción: Supabase cloud, Vercel, dominios, Redirect URLs de auth, rate limiting del chat público.
- [`credenciales-pendientes.md`](credenciales-pendientes.md) — las 15 credenciales/APIs externas que activan adaptadores ya construidos (SII, MercadoPago, Resend, Anthropic, Meta WhatsApp…). Todo funciona hoy con mocks.
- [`incidentes/`](incidentes) — registro de incidentes operacionales y sus checklists (documentación ACHS, plazos legales).

## Diseño e implementación por fase

- [`superpowers/specs/`](superpowers/specs) — un spec de diseño por feature (aprobados antes de implementar).
- [`superpowers/plans/`](superpowers/plans) — los planes de implementación ejecutados, con sus constraints contractuales (conteos de tests, mensajes byte-exactos) y seams documentados.

La numeración de planes (1-21) sigue el roadmap; los specs sueltos posteriores
(recuperación de contraseña, consultas/tickets, chat de ventas, avisos WhatsApp)
son las iteraciones de producto sobre esa base.
