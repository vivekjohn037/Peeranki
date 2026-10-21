-- Match wins earn 100 points. Apply after 008_authenticated_room_access.sql.
BEGIN;
CREATE TABLE IF NOT EXISTS public.leaderboard (
  player_id uuid PRIMARY KEY,
  player_name text NOT NULL,
  points bigint NOT NULL DEFAULT 0 CHECK (points >= 0),
  wins bigint NOT NULL DEFAULT 0 CHECK (wins >= 0)
);
CREATE TABLE IF NOT EXISTS public.ranked_match_results (
  room_id bigint NOT NULL,
  match_started_at text NOT NULL,
  PRIMARY KEY (room_id, match_started_at)
);
ALTER TABLE public.leaderboard ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ranked_match_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.leaderboard, public.ranked_match_results FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.leaderboard TO authenticated;
DROP POLICY IF EXISTS "Players can read global rankings" ON public.leaderboard;
CREATE POLICY "Players can read global rankings" ON public.leaderboard FOR SELECT TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS leaderboard_ranking ON public.leaderboard (points DESC, wins DESC, player_id);

CREATE OR REPLACE FUNCTION public.record_match_wins() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  started text;
  highest integer;
  participant jsonb;
BEGIN
  IF NEW.game_status <> 'finished' OR OLD.game_status = 'finished' OR OLD.game_status = 'waiting' THEN
    RETURN NEW;
  END IF;
  SELECT p->>'match_started_at' INTO started FROM jsonb_array_elements(NEW.players) p
    WHERE coalesce(p->>'match_started_at', '') <> '' LIMIT 1;
  IF started IS NULL THEN RETURN NEW; END IF;
  -- Early departures mark some rooms finished without completing the match.
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.players) p WHERE p->>'match_over' = 'true') THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.ranked_match_results VALUES (NEW.id, started) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT max(jsonb_array_length(p->'weapons')) INTO highest
    FROM jsonb_array_elements(NEW.players) p WHERE p->>'connected' = 'true';
  FOR participant IN SELECT p FROM jsonb_array_elements(NEW.players) p
    WHERE p->>'connected' = 'true' AND jsonb_array_length(p->'weapons') = highest
      AND coalesce(p->>'auth_uid', '') <> ''
  LOOP
    INSERT INTO public.leaderboard AS rankings (player_id, player_name, points, wins)
      VALUES ((participant->>'auth_uid')::uuid, left(coalesce(nullif(participant->>'name', ''), 'Player'), 40), 100, 1)
      ON CONFLICT (player_id) DO UPDATE SET player_name = EXCLUDED.player_name,
        points = rankings.points + 100, wins = rankings.wins + 1;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.record_match_wins() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS record_match_wins ON public.game_states;
CREATE TRIGGER record_match_wins AFTER UPDATE ON public.game_states FOR EACH ROW EXECUTE FUNCTION public.record_match_wins();
COMMIT;
