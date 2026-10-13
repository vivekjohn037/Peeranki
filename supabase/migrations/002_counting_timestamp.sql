-- ============================================================================
-- Migration 002: Add counting_start_timestamp to public.game_states
-- ============================================================================
-- Eliminates tick-by-tick network broadcasts and database writes during
-- the tower selection phase. All clients derive the current counted tower
-- locally from elapsed time:
-- count = clamp(floor((now - counting_start_timestamp) / 200ms), 0, 10)
-- ============================================================================

ALTER TABLE public.game_states
ADD COLUMN IF NOT EXISTS counting_start_timestamp TIMESTAMPTZ DEFAULT NULL;

-- Partial index for active counting phases
CREATE INDEX IF NOT EXISTS idx_game_states_counting_started
ON public.game_states (counting_start_timestamp)
WHERE game_status = 'counting';
