CREATE POLICY "service role manages math bot rate limits"
ON private.math_bot_rate_limits
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
