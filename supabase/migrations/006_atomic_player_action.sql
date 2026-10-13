-- Store online shots without letting a stale client player snapshot overwrite the room.
-- The host remains responsible for validating game rules and applying damage.

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
        'action_timeout',
        'shot',
        'round_won',
        'duel',
        'finished'
    ));

CREATE OR REPLACE FUNCTION public.request_player_action(
    p_room_code TEXT,
    p_session_id TEXT,
    p_action JSONB
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
    v_shooter_id INTEGER;
    v_deadline TIMESTAMPTZ;
    v_received_at TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF length(v_code) <> 6 OR v_session = '' OR jsonb_typeof(p_action) <> 'object' THEN
        RAISE EXCEPTION 'Invalid shot request.' USING ERRCODE = 'P0001';
    END IF;

    IF coalesce(p_action->>'nonce', '') = '' OR coalesce(p_action->>'weapon', '') = '' THEN
        RAISE EXCEPTION 'Invalid shot request.' USING ERRCODE = 'P0001';
    END IF;

    v_shooter_id := (p_action->>'shooterId')::INTEGER;
    IF v_shooter_id < 1 OR jsonb_typeof(p_action->'targetIds') <> 'array' THEN
        RAISE EXCEPTION 'Invalid shot request.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_room
    FROM public.game_states
    WHERE room_code = v_code
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Room does not exist.' USING ERRCODE = 'P0001';
    END IF;

    IF v_room.game_status <> 'shooting' OR v_room.current_shooter <> v_shooter_id - 1 THEN
        RAISE EXCEPTION 'This shooting turn has ended or belongs to another player.' USING ERRCODE = 'P0001';
    END IF;

    SELECT nullif(p->>'shooting_deadline_at', '')::TIMESTAMPTZ
    INTO v_deadline
    FROM jsonb_array_elements(coalesce(v_room.players, '[]'::JSONB)) AS p
    WHERE (p->>'id')::INTEGER = v_shooter_id
      AND p->>'session_id' = v_session
      AND coalesce((p->>'connected')::BOOLEAN, false)
      AND coalesce((p->>'alive')::BOOLEAN, false);

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The active shooter session could not be verified.' USING ERRCODE = 'P0001';
    END IF;
    -- Leave a second for the host client to process the database event before
    -- its local timeout advances the turn (the client also has a 3s grace).
    IF v_deadline IS NULL OR v_received_at > v_deadline + interval '2 seconds' THEN
        RAISE EXCEPTION 'The shot arrived after the action window ended.' USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(coalesce(v_room.players, '[]'::JSONB)) AS p
        WHERE (p->>'id')::INTEGER = v_shooter_id
          AND p->'action_request' IS NOT NULL
          AND p->'action_request' <> 'null'::JSONB
    ) THEN
        IF EXISTS (
            SELECT 1 FROM jsonb_array_elements(coalesce(v_room.players, '[]'::JSONB)) AS p
            WHERE (p->>'id')::INTEGER = v_shooter_id
              AND p->'action_request'->>'nonce' = p_action->>'nonce'
        ) THEN
            RETURN v_room;
        END IF;
        RAISE EXCEPTION 'A shot from this turn is already being processed.' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.game_states AS g
    SET players = (
            SELECT coalesce(
                jsonb_agg(
                    CASE WHEN (p->>'id')::INTEGER = v_shooter_id
                        THEN p || jsonb_build_object(
                            'action_request', p_action || jsonb_build_object('received_at', v_received_at::TEXT)
                        )
                        ELSE p
                    END
                    ORDER BY (p->>'id')::INTEGER
                ),
                '[]'::JSONB
            )
            FROM jsonb_array_elements(coalesce(g.players, '[]'::JSONB)) AS p
        ),
        updated_at = v_received_at
    WHERE g.room_code = v_code
    RETURNING * INTO v_room;

    RETURN v_room;
END;
$$;

REVOKE ALL ON FUNCTION public.request_player_action(TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_player_action(TEXT, TEXT, JSONB) TO anon, authenticated;
