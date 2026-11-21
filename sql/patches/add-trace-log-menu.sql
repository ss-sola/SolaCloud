BEGIN;

-- Initial seed data can use explicit IDs. Align identity sequences before inserting.
LOCK TABLE public.sys_permission, public.sys_menu_route, public.sys_menu_route_permission,
  public.sys_role_permission IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  table_name text;
  identity_sequence regclass;
  max_id bigint;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'sys_permission', 'sys_menu_route', 'sys_menu_route_permission', 'sys_role_permission'
  ]
  LOOP
    identity_sequence := pg_get_serial_sequence('public.' || table_name, 'id');
    EXECUTE format('SELECT coalesce(max(id), 0) FROM public.%I', table_name) INTO max_id;
    IF pg_sequence_last_value(identity_sequence) IS NULL
      OR pg_sequence_last_value(identity_sequence) < max_id THEN
      PERFORM setval(identity_sequence, greatest(max_id, 1), max_id > 0);
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sys_menu_route
    WHERE code = 'system-observe-group' AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot install the trace log menu because system-observe-group is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sys_permission WHERE code = 'system:trace-log:query')
    AND NOT EXISTS (SELECT 1 FROM public.sys_role WHERE code = 'system-admin' AND deleted_at IS NULL)
  THEN
    RAISE EXCEPTION 'Cannot seed the trace log permission because system-admin is missing';
  END IF;
END $$;

-- Default grant applies only to newly installed permissions. A rerun must not
-- restore grants that were explicitly removed afterwards.
WITH installed_permission AS (
  INSERT INTO public.sys_permission (code, name, group_key, description)
  VALUES ('system:trace-log:query', '集中日志查询', 'audit', '按 traceId 查询网关和服务实例日志')
  ON CONFLICT (code) DO NOTHING
  RETURNING id
)
INSERT INTO public.sys_role_permission (role_id, permission_id)
SELECT admin.id, permission.id
FROM public.sys_role AS admin
CROSS JOIN installed_permission AS permission
WHERE admin.code = 'system-admin' AND admin.deleted_at IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.sys_menu_route (code, name, route_name, parent_id, icon, sort, route_root)
SELECT 'trace-log-page', '集中日志查询', 'trace-log', id, 'operation-log', 3, 'system'
FROM public.sys_menu_route
WHERE code = 'system-observe-group' AND deleted_at IS NULL
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.sys_menu_route_permission (menu_route_id, permission_id)
SELECT menu.id, permission.id
FROM public.sys_menu_route AS menu
CROSS JOIN public.sys_permission AS permission
WHERE menu.code = 'trace-log-page' AND menu.deleted_at IS NULL
  AND permission.code = 'system:trace-log:query' AND permission.deleted_at IS NULL
ON CONFLICT (menu_route_id, permission_id) DO NOTHING;

COMMIT;
