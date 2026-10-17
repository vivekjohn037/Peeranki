-- ============================================================================
-- Peeranki Migration 002: Countdown Synchronization & Host Claiming RPC
-- Compatible with Supabase PostgreSQL (PostgREST + Realtime)
-- ============================================================================

-- 1. Add dedicated countdown synchronization columns to public.game_states (idempotent)
ALTER TABLE public.game_states
ADD COLUMN IF NOT EXISTS counting_started_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE public.game_states
ADD COLUMN IF NOT EXISTS counting_start_index INTEGER DEFAULT -1;

ALTER TABLE public.game_states
ADD COLUMN IF NOT EXISTS shooting_deadline_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Create index for fast host session lookup
CREATE INDEX IF NOT EXISTS idx_game_states_host_session
ON public.game_states (room_code, host_session_id);

-- ----------------------------------------------------------------------------
-- RPC: claim_host
-- Atomically reassigns room host if current host is disconnected or stale,
-- preventing duplicate hosts or race conditions between clients.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_host(
    p_room_code TEXT,
    p_session_id TEXT,
    p_force BOOLEAN DEFAULT false
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
    v_current_host_connected BOOLEAN := false;
    v_caller_is_connected BOOLEAN := false;
    v_cutoff TIMESTAMPTZ := now() - interval '25 seconds';
BEGIN
    IF length(v_code) != 6 OR length(v_session) = 0 THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_room
    FROM public.game_states
    WHERE room_code = v_code
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    v_players := coalesce(v_room.players, '[]'::jsonb);

    -- Inspect connection status of caller and current host
    FOR v_i IN 0 .. (jsonb_array_length(v_players) - 1) LOOP
        v_elem := v_players->v_i;
        IF (v_elem->>'connected')::boolean = true AND
           ((v_elem->>'last_seen')::timestamptz IS NULL OR (v_elem->>'last_seen')::timestamptz > v_cutoff) THEN
            IF (v_elem->>'session_id') = v_room.host_session_id THEN
                v_current_host_connected := true;
            END IF;
            IF (v_elem->>'session_id') = v_session THEN
                v_caller_is_connected := true;
            END IF;
        END IF;
    END LOOP;

    -- Only allow claiming if:
    -- 1. Caller is an active connected player in the room
    -- 2. And either current host is disconnected/stale, or caller is already host, or p_force is true
    IF v_caller_is_connected AND (NOT v_current_host_connected OR v_room.host_session_id = v_session OR p_force) THEN
        UPDATE public.game_states
        SET host_session_id = v_session,
            updated_at = now()
        WHERE room_code = v_code
        RETURNING * INTO v_room;
    END IF;

    RETURN v_room;
END;
$$;

-- Grant EXECUTE permission to anon and authenticated
GRANT EXECUTE ON FUNCTION public.claim_host TO anon, authenticated;
