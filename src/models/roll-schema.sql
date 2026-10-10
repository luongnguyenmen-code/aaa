CREATE TABLE IF NOT EXISTS st25_roll_rounds (
 id bigint PRIMARY KEY, starts_at bigint NOT NULL, closes_at bigint NOT NULL,
 ends_at bigint NOT NULL, seed text NOT NULL, commitment text NOT NULL, result integer NOT NULL CHECK(result BETWEEN 0 AND 14)
);
CREATE TABLE IF NOT EXISTS st25_roll_bets (
 id uuid PRIMARY KEY, steam_id varchar(17) NOT NULL, round_id bigint NOT NULL REFERENCES st25_roll_rounds(id),
 request_id uuid NOT NULL, color text NOT NULL CHECK(color IN ('red','black','green')),
 amount integer NOT NULL CHECK(amount BETWEEN 1 AND 1000), payout integer NOT NULL DEFAULT 0,
 status text NOT NULL CHECK(status IN ('debit_pending','placed','credit_pending','settled','review')),
 balance double precision, created_at bigint NOT NULL, updated_at bigint NOT NULL,
 UNIQUE(steam_id,round_id), UNIQUE(steam_id,request_id)
);
CREATE INDEX IF NOT EXISTS st25_roll_bets_history ON st25_roll_bets(steam_id,round_id DESC);
CREATE TABLE IF NOT EXISTS st25_roll_commands (
 steam_id varchar(17) NOT NULL, request_id uuid NOT NULL, bet_id uuid NOT NULL REFERENCES st25_roll_bets(id),
 PRIMARY KEY(steam_id,request_id)
);
