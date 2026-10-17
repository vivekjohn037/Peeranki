-- Store each Rock-Paper-Scissors choice under a row lock so simultaneous
-- submissions cannot overwrite one another's player snapshot.
CREATE OR REPLACE FUNCTION public.submit_duel_choice(
    p_room_code TEXT,
    p_session_id TEXT,
    p_duel_round INTEGER,
    p_choice TEXT,
    p_nonce TEXT
)
RETURNS public.game_states
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code TEXT := upper(trim(coalesce(p_room_code, '')));
    v_session TEXT := trim(coalesce(p_session_id, ''));
    v_room public.game_states%ROWTYPE;
    v_player_id INTEGER;
    v_existing_choice TEXT;
    v_alive_count INTEGER;
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF length(v_code) <> 6 OR v_session = '' OR p_duel_round < 1
       OR lower(coalesce(p_choice, '')) NOT IN ('rock', 'paper', 'scissors')
       OR trim(coalesce(p_nonce, '')) = '' THEN
        RAISE EXCEPTION 'Invalid duel choice.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_room
    FROM public.game_states
    WHERE room_code = v_code
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Room does not exist.' USING ERRCODE = 'P0001';
    END IF;
    IF auth.uid() IS NULL OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(coalesce(v_room.players, '[]'::JSONB)) AS p
        WHERE p->>'session_id' = v_session AND p->>'auth_uid' = auth.uid()::TEXT
    ) THEN
        RAISE EXCEPTION 'This player session does not belong to the authenticated user.' USING ERRCODE = '42501';
    END IF;
    IF v_room.game_status <> 'duel' THEN
        RAISE EXCEPTION 'The duel is no longer accepting choices.' USING ERRCODE = 'P0001';
    END IF;

    SELECT count(*)::INTEGER INTO v_alive_count
    FROM jsonb_array_elements(coalesce(v_room.players, '[]'::JSONB)) AS p
    WHERE coalesce((p->>'connected')::BOOLEAN, false)
      AND coalesce((p->>'alive')::BOOLEAN, false);
    IF v_alive_count <> 2 THEN
        RAISE EXCEPTION 'The duel contestants are no longer available.' USING ERRCODE = 'P0001';
    END IF;

    SELECT (p->>'id')::INTEGER, nullif(p->>'duel_choice', '')
      INTO v_player_id, v_existing_choice
    FROM jsonb_array_elements(coalesce(v_room.players, '[]'::JSONB)) AS p
    WHERE p->>'session_id' = v_session
      AND coalesce((p->>'connected')::BOOLEAN, false)
      AND coalesce((p->>'alive')::BOOLEAN, false)
      AND coalesce((p->>'duel_round')::INTEGER, 1) = p_duel_round
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'This session is not an active contestant in that duel round.' USING ERRCODE = 'P0001';
    END IF;

    IF v_existing_choice IS NOT NULL THEN
        IF v_existing_choice = lower(p_choice) THEN
            RETURN v_room;
        END IF;
        RAISE EXCEPTION 'A choice is already locked for this duel round.' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.game_states AS g
    SET players = (
            SELECT coalesce(
                jsonb_agg(
                    CASE WHEN (p->>'id')::INTEGER = v_player_id
                        THEN p || jsonb_build_object(
                            'duel_choice', lower(p_choice),
                            'duel_choice_request', NULL,
                            'duel_choice_nonce', p_nonce
                        )
                        ELSE p
                    END
                    ORDER BY (p->>'id')::INTEGER
                ),
                '[]'::JSONB
            )
            FROM jsonb_array_elements(coalesce(g.players, '[]'::JSONB)) AS p
        ),
        updated_at = v_now
    WHERE g.room_code = v_code
    RETURNING * INTO v_room;

    RETURN v_room;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_duel_choice(TEXT, TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_duel_choice(TEXT, TEXT, INTEGER, TEXT, TEXT) TO anon, authenticated;
