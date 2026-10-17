-- Restrict each room to its anonymous-authenticated participants.
-- Run after migrations 001-007 on the new Mumbai project.

DROP POLICY IF EXISTS "Allow public read access" ON public.game_states;
DROP POLICY IF EXISTS "Allow public insert" ON public.game_states;
DROP POLICY IF EXISTS "Allow public update" ON public.game_states;
DROP POLICY IF EXISTS "Room members can read" ON public.game_states;
DROP POLICY IF EXISTS "Players can create their rooms" ON public.game_states;
DROP POLICY IF EXISTS "Room members can update" ON public.game_states;

REVOKE ALL ON public.game_states FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.game_states TO authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.game_states_id_seq TO authenticated;

CREATE POLICY "Room members can read"
ON public.game_states
FOR SELECT TO authenticated
USING (players @> jsonb_build_array(jsonb_build_object('auth_uid', auth.uid()::text)));

CREATE POLICY "Players can create their rooms"
ON public.game_states
FOR INSERT TO authenticated
WITH CHECK (
    auth.uid() IS NOT NULL
    AND players @> jsonb_build_array(jsonb_build_object('auth_uid', auth.uid()::text))
);

CREATE POLICY "Room members can update"
ON public.game_states
FOR UPDATE TO authenticated
USING (players @> jsonb_build_array(jsonb_build_object('auth_uid', auth.uid()::text)))
WITH CHECK (players @> jsonb_build_array(jsonb_build_object('auth_uid', auth.uid()::text)));

-- RPCs are the only way to join rooms or perform atomic actions. Revoke the
-- default PUBLIC/anon execution grant, then expose them only to Auth users.
REVOKE ALL ON FUNCTION public.join_private_room(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_private_room(TEXT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.find_or_create_public_room(INTEGER, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_or_create_public_room(INTEGER, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.touch_player(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_player(TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.cleanup_stale_players(TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_players(TEXT, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.leave_room(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_room(TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.claim_room_host(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_room_host(TEXT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.request_player_action(TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_player_action(TEXT, TEXT, JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.submit_duel_choice(TEXT, TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_duel_choice(TEXT, TEXT, INTEGER, TEXT, TEXT) TO authenticated;

COMMENT ON TABLE public.game_states IS
    'Room rows are visible only to anonymous-authenticated players whose auth_uid is present in the room roster.';
