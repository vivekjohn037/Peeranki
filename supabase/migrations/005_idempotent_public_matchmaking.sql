-- Make public matchmaking safe to retry after a slow or interrupted RPC.
-- Production currently exposes this RPC as JSONB; drop/recreate also upgrades
-- installations where migration 001 created the earlier composite return type.

DROP FUNCTION IF EXISTS public.find_or_create_public_room(INTEGER, TEXT, TEXT);

CREATE FUNCTION public.find_or_create_public_room(
    p_max_players INTEGER,
    p_player_name TEXT,
    p_session_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    room_row public.game_states%ROWTYPE;
    room_players JSONB;
    new_player_id INTEGER;
    candidate TEXT;
    chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    outer_attempt INTEGER;
    char_index INTEGER;
    stale_cutoff TIMESTAMPTZ := now() - interval '30 seconds';
BEGIN
    IF p_max_players IS NULL OR p_max_players < 3 OR p_max_players > 10 THEN
        RAISE EXCEPTION 'Player count must be between 3 and 10';
    END IF;

    p_player_name := left(trim(coalesce(p_player_name, '')), 16);
    p_session_id := trim(coalesce(p_session_id, ''));

    IF p_player_name = '' OR p_session_id = '' THEN
        RAISE EXCEPTION 'Player name and session are required';
    END IF;

    -- Serialize retries from the same client session to prevent duplicate rooms.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_session_id, 0));

    -- Remove disconnected players from stale waiting public rooms before matching.
    UPDATE public.game_states AS g
    SET players = COALESCE(
            (
                SELECT jsonb_agg(elem ORDER BY (elem->>'id')::INTEGER)
                FROM jsonb_array_elements(COALESCE(g.players, '[]'::JSONB)) AS elem
                WHERE COALESCE((elem->>'last_seen')::TIMESTAMPTZ, now()) >= stale_cutoff
            ),
            '[]'::JSONB
        ),
        updated_at = now()
    WHERE g.is_public = true
      AND g.game_status = 'waiting'
      AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(g.players, '[]'::JSONB)) AS elem
          WHERE COALESCE((elem->>'last_seen')::TIMESTAMPTZ, now()) < stale_cutoff
      );

    -- A retry from a session already in a waiting public room returns that room
    -- and refreshes its heartbeat instead of raising a duplicate-session error.
    SELECT * INTO room_row
    FROM public.game_states AS g
    WHERE g.is_public = true
      AND g.game_status = 'waiting'
      AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(g.players, '[]'::JSONB)) AS p
          WHERE p->>'session_id' = p_session_id
      )
    ORDER BY g.updated_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF FOUND THEN
        SELECT COALESCE(
            jsonb_agg(
                CASE WHEN p->>'session_id' = p_session_id
                    THEN p || jsonb_build_object('connected', true, 'last_seen', now()::TEXT)
                    ELSE p
                END
                ORDER BY (p->>'id')::INTEGER
            ),
            '[]'::JSONB
        ) INTO room_players
        FROM jsonb_array_elements(COALESCE(room_row.players, '[]'::JSONB)) AS p;

        UPDATE public.game_states
        SET players = room_players, updated_at = now()
        WHERE room_code = room_row.room_code;

        RETURN jsonb_build_object(
            'room_code', room_row.room_code,
            'max_players', room_row.max_players,
            'is_public', room_row.is_public,
            'host_session_id', room_row.host_session_id,
            'players', room_players,
            'game_status', room_row.game_status
        );
    END IF;

    -- Skip rooms where this display name is already taken. Starting a separate
    -- waiting room is preferable to failing the entire matchmaking request.
    FOR room_row IN
        SELECT *
        FROM public.game_states AS g
        WHERE g.is_public = true
          AND g.game_status = 'waiting'
          AND g.max_players = p_max_players
          AND jsonb_array_length(COALESCE(g.players, '[]'::JSONB)) < p_max_players
          AND NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(g.players, '[]'::JSONB)) AS p
              WHERE lower(trim(p->>'name')) = lower(p_player_name)
          )
          AND NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(g.players, '[]'::JSONB)) AS p
              WHERE p->>'session_id' = p_session_id
          )
        ORDER BY g.updated_at ASC
        FOR UPDATE SKIP LOCKED
    LOOP
        room_players := COALESCE(room_row.players, '[]'::JSONB);

        SELECT min(slot_id)
        INTO new_player_id
        FROM generate_series(1, room_row.max_players) AS slot_id
        WHERE NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(room_players) AS p
            WHERE (p->>'id')::INTEGER = slot_id
        );

        room_players := room_players || jsonb_build_array(
            jsonb_build_object(
                'id', new_player_id,
                'name', p_player_name,
                'stage', 0,
                'alive', true,
                'session_id', p_session_id,
                'connected', true,
                'last_seen', now()::TEXT
            )
        );

        UPDATE public.game_states
        SET players = room_players, updated_at = now()
        WHERE room_code = room_row.room_code;

        RETURN jsonb_build_object(
            'room_code', room_row.room_code,
            'max_players', room_row.max_players,
            'is_public', true,
            'host_session_id', room_row.host_session_id,
            'players', room_players,
            'game_status', room_row.game_status
        );
    END LOOP;

    -- No compatible room was available, so create one with a unique six-character code.
    FOR outer_attempt IN 1..20 LOOP
        candidate := '';
        FOR char_index IN 1..6 LOOP
            candidate := candidate || substr(chars, floor(random() * length(chars))::INTEGER + 1, 1);
        END LOOP;

        BEGIN
            INSERT INTO public.game_states (
                room_code, players, max_players, is_public, host_session_id,
                current_shooter, countdown, game_status, updated_at
            ) VALUES (
                candidate,
                jsonb_build_array(jsonb_build_object(
                    'id', 1,
                    'name', p_player_name,
                    'stage', 0,
                    'alive', true,
                    'session_id', p_session_id,
                    'connected', true,
                    'last_seen', now()::TEXT,
                    'weapons', jsonb_build_array('gun'),
                    'all_weapons_collected', false,
                    'elimination_points', 0,
                    'shield_disabled_round', -1
                )),
                p_max_players, true, p_session_id, NULL, 0, 'waiting', now()
            )
            RETURNING * INTO room_row;

            RETURN jsonb_build_object(
                'room_code', room_row.room_code,
                'max_players', room_row.max_players,
                'is_public', true,
                'host_session_id', room_row.host_session_id,
                'players', room_row.players,
                'game_status', room_row.game_status
            );
        EXCEPTION WHEN unique_violation THEN
            -- Retry with another generated code.
            NULL;
        END;
    END LOOP;

    RAISE EXCEPTION 'Could not create a public room';
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_or_create_public_room(INTEGER, TEXT, TEXT)
TO anon, authenticated;

