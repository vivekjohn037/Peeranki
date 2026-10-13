-- Persist every phase written by the client and end 3-player matches atomically on leave.

ALTER TABLE public.game_states
    DROP CONSTRAINT IF EXISTS game_states_game_status_check;

ALTER TABLE public.game_states
    ADD CONSTRAINT game_states_game_status_check
    CHECK (game_status IN (
        'waiting',
        'playing',
        'counting',
        'shooting',
        'action_requested',
        'shot',
        'round_won',
        'duel',
        'finished'
    ));

-- Earlier deployed versions returned JSONB, while migration 001 declares the
-- game_states composite return type. PostgreSQL cannot change a function's
-- return type with CREATE OR REPLACE, so replace the RPC explicitly.
DROP FUNCTION IF EXISTS public.leave_room(TEXT, TEXT);

CREATE FUNCTION public.leave_room(
    p_room_code TEXT,
    p_session_id TEXT
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
    v_players JSONB;
    v_i INTEGER;
    v_elem JSONB;
    v_changed BOOLEAN := false;
    v_now TEXT := to_jsonb(now()::timestamptz)#>>'{}';
    v_status TEXT;
BEGIN
    SELECT * INTO v_room
    FROM public.game_states
    WHERE room_code = v_code
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    v_players := coalesce(v_room.players, '[]'::jsonb);

    FOR v_i IN 0 .. (jsonb_array_length(v_players) - 1) LOOP
        v_elem := v_players->v_i;
        IF (v_elem->>'session_id') = v_session THEN
            v_players := jsonb_set(v_players, ARRAY[v_i::text, 'connected'], 'false'::jsonb);
            v_players := jsonb_set(v_players, ARRAY[v_i::text, 'alive'], 'false'::jsonb);
            v_players := jsonb_set(v_players, ARRAY[v_i::text, 'last_seen'], to_jsonb(v_now));
            v_changed := true;
            EXIT;
        END IF;
    END LOOP;

    IF v_changed THEN
        v_status := CASE
            WHEN v_room.max_players = 3 AND v_room.game_status NOT IN ('waiting', 'finished')
                THEN 'finished'
            ELSE v_room.game_status
        END;

        UPDATE public.game_states
        SET players = v_players,
            game_status = v_status,
            updated_at = now()
        WHERE room_code = v_code
        RETURNING * INTO v_room;
    END IF;

    RETURN v_room;
END;
$$;

GRANT EXECUTE ON FUNCTION public.leave_room(TEXT, TEXT) TO anon, authenticated;
