-- JIMS STAGING ONLY: initialise missing Petty Cash numbering configuration.
-- Idempotent; preserves any existing revision already configured.
INSERT INTO private.jims_pc_number_config_v1 (id,current_revision)
VALUES (1,1)
ON CONFLICT (id) DO NOTHING;
