BEGIN;

-- 历史初始数据使用显式 ID。先锁表并补齐序列，再通过普通主键分配插入缺失项。
LOCK TABLE public.sys_dict_aggregate, public.sys_dict_item IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  table_name text;
  identity_sequence regclass;
  max_id bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sys_dict_namespace WHERE namespace = 'system' AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot install the call graph probe dictionary: system namespace is missing';
  END IF;
  FOREACH table_name IN ARRAY ARRAY['sys_dict_aggregate', 'sys_dict_item']
  LOOP
    identity_sequence := pg_get_serial_sequence('public.' || table_name, 'id');
    EXECUTE format('SELECT max(id) FROM public.%I', table_name) INTO max_id;
    IF max_id IS NOT NULL AND coalesce(pg_sequence_last_value(identity_sequence), 0) < max_id THEN
      PERFORM setval(identity_sequence, max_id);
    END IF;
  END LOOP;
END $$;

INSERT INTO public.sys_dict_aggregate (namespace, aggregate_key, label, description)
VALUES ('system', 'api_call_graph_probe', '接口调用图探针', '控制每个请求的方法调用记录数及每次调用的快照值数量')
ON CONFLICT (namespace, aggregate_key) DO NOTHING;

INSERT INTO public.sys_dict_item (namespace, aggregate_key, dict_key, value, label, description)
SELECT a.namespace, a.aggregate_key, v.dict_key, v.value, v.label, v.description
FROM public.sys_dict_aggregate AS a
CROSS JOIN (VALUES
  ('maxCallsPerRequest', '0'::jsonb, '每个请求最多记录的方法调用次数', '非负整数，0 表示不限制次数'),
  ('maxSnapshotValuesPerCall', '1000'::jsonb, '每次方法调用最多采集的快照值数量', '入参与出参共用此额度，非负整数，0 表示不限制值数量')
) AS v(dict_key, value, label, description)
WHERE a.namespace = 'system' AND a.aggregate_key = 'api_call_graph_probe' AND a.deleted_at IS NULL
ON CONFLICT (namespace, aggregate_key, dict_key) DO NOTHING;

COMMIT;
