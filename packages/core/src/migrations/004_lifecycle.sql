CREATE TABLE IF NOT EXISTS lifecycle_transitions (machine text NOT NULL, from_state text NOT NULL, to_state text NOT NULL, PRIMARY KEY(machine,from_state,to_state));
CREATE OR REPLACE FUNCTION skilled_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_name text;
BEGIN
 IF NEW.status=OLD.status THEN RETURN NEW; END IF;
 IF current_setting('skilled.importing',true)='true' THEN
   SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid=TG_RELID;
   IF current_user=owner_name THEN RETURN NEW; END IF;
 END IF;
 PERFORM 1 FROM lifecycle_transitions WHERE machine=TG_ARGV[0] AND from_state=OLD.status AND to_state=NEW.status;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid % transition: % -> %',TG_ARGV[0],OLD.status,NEW.status USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lifecycle_eval BEFORE UPDATE OF status ON eval_versions FOR EACH ROW EXECUTE FUNCTION skilled_transition_guard('eval');
CREATE TRIGGER lifecycle_run BEFORE UPDATE OF status ON runs FOR EACH ROW EXECUTE FUNCTION skilled_transition_guard('run');
CREATE TRIGGER lifecycle_proposal BEFORE UPDATE OF status ON update_proposals FOR EACH ROW EXECUTE FUNCTION skilled_transition_guard('proposal');
CREATE TRIGGER lifecycle_job BEFORE UPDATE OF status ON jobs FOR EACH ROW EXECUTE FUNCTION skilled_transition_guard('job');
