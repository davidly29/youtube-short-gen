-- credit_ledger is append-only: corrections are new rows with a negative or positive delta.
CREATE OR REPLACE FUNCTION credit_ledger_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'credit_ledger is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER credit_ledger_append_only
BEFORE UPDATE OR DELETE ON credit_ledger
FOR EACH ROW EXECUTE FUNCTION credit_ledger_reject_change();
