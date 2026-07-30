-- El registro de correos guarda también el HTML enviado, para poder ver el detalle
-- después (página /correo/[id]). Nullable: las filas anteriores a esta migración no
-- tienen contenido y la página lo dice. Los grants de tabla existentes (select, insert
-- a authenticated) cubren la columna nueva; RLS sin cambios.
alter table public.correos_enviados add column html text;
