CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

CREATE TABLE IF NOT EXISTS private.math_bot_rate_limits (
  client_hash text PRIMARY KEY CHECK (client_hash ~ '^[0-9a-f]{64}$'),
  minute_bucket timestamptz NOT NULL,
  minute_count integer NOT NULL CHECK (minute_count > 0),
  day_bucket date NOT NULL,
  day_count integer NOT NULL CHECK (day_count > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE private.math_bot_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.math_bot_rate_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.math_bot_rate_limits TO service_role;
CREATE INDEX IF NOT EXISTS math_bot_rate_limits_updated_at_idx
  ON private.math_bot_rate_limits (updated_at);

CREATE OR REPLACE FUNCTION public.consume_math_bot_rate_limit(p_client_hash text)
RETURNS TABLE (
  allowed boolean,
  retry_after_seconds integer,
  daily_remaining integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, private
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_minute_bucket timestamptz := date_trunc('minute', v_now);
  v_day_bucket date := (v_now AT TIME ZONE 'UTC')::date;
  v_minute_count integer;
  v_day_count integer;
BEGIN
  IF p_client_hash IS NULL OR p_client_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid client hash' USING ERRCODE = '22023';
  END IF;

  INSERT INTO private.math_bot_rate_limits AS current_limit (
    client_hash, minute_bucket, minute_count, day_bucket, day_count, updated_at
  )
  VALUES (p_client_hash, v_minute_bucket, 1, v_day_bucket, 1, v_now)
  ON CONFLICT (client_hash) DO UPDATE SET
    minute_count = CASE
      WHEN current_limit.minute_bucket < EXCLUDED.minute_bucket THEN 1
      ELSE current_limit.minute_count + 1
    END,
    minute_bucket = EXCLUDED.minute_bucket,
    day_count = CASE
      WHEN current_limit.day_bucket < EXCLUDED.day_bucket THEN 1
      ELSE current_limit.day_count + 1
    END,
    day_bucket = EXCLUDED.day_bucket,
    updated_at = EXCLUDED.updated_at
  RETURNING current_limit.minute_count, current_limit.day_count
  INTO v_minute_count, v_day_count;

  DELETE FROM private.math_bot_rate_limits
  WHERE updated_at < v_now - interval '2 days';

  RETURN QUERY
  SELECT
    (v_minute_count <= 5 AND v_day_count <= 40),
    CASE
      WHEN v_day_count > 40 THEN GREATEST(
        1,
        CEIL(EXTRACT(EPOCH FROM (((v_day_bucket + 1)::timestamp AT TIME ZONE 'UTC') - v_now)))::integer
      )
      ELSE GREATEST(
        1,
        CEIL(EXTRACT(EPOCH FROM ((v_minute_bucket + interval '1 minute') - v_now)))::integer
      )
    END,
    GREATEST(0, 40 - v_day_count);
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_math_bot_rate_limit(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_math_bot_rate_limit(text) TO service_role;
