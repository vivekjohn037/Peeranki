-- Atomically transfer room authority to the lowest-ID active player.
-- The expected host ID makes concurrent or stale claims fail closed.
CREATE OR REPLACE FUNCTION public.claim_room_host(
    p_room_code TEXT,
    p_expected_host_session_id TEXT,
    p_new_host_session_id TEXT
)
RETURNS public.game_states
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code TEXT := upper(trim(coalesce(p_room_code, '')));
    v_expected TEXT := trim(coalesce(p_expected_host_session_id, ''));
    v_new TEXT := trim(coalesce(p_new_host_session_id, ''));
    v_room public.game_states%ROWTYPE;
    v_elected TEXT;
BEGIN
    IF v_code = '' OR v_expected = '' OR v_new = '' THEN
        RETURN NULL;
    END IF;

    IF auth.uid() IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.game_states AS g,
             jsonb_array_elements(coalesce(g.players, '[]'::jsonb)) AS p
        WHERE g.room_code = v_code AND p->>'auth_uid' = auth.uid()::TEXT
    ) THEN
        RAISE EXCEPTION 'Only a room member can transfer host authority' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_room
    FROM public.game_states
    WHERE room_code = v_code
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- A stale caller cannot replace a host elected by another client.
    IF v_room.host_session_id IS DISTINCT FROM v_expected THEN
        RETURN v_room;
    END IF;

    -- All clients use the same roster order; only the first active player may claim.
    SELECT player->>'session_id' INTO v_elected
    FROM jsonb_array_elements(coalesce(v_room.players, '[]'::jsonb)) AS player
    WHERE coalesce((player->>'connected')::boolean, false)
      AND coalesce((player->>'alive')::boolean, false)
      AND coalesce(player->>'session_id', '') <> ''
      AND player->>'session_id' <> v_expected
    ORDER BY coalesce((player->>'id')::integer, 2147483647)
    LIMIT 1;

    IF v_elected IS DISTINCT FROM v_new THEN
        RETURN v_room;
    END IF;

    UPDATE public.game_states
    SET host_session_id = v_new,
        updated_at = now()
    WHERE id = v_room.id
    RETURNING * INTO v_room;

    RETURN v_room;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_room_host(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_room_host(TEXT, TEXT, TEXT) TO anon, authenticated;
