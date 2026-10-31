-- 57D7C7: JIMS-STAGING private bucket definitions.
-- Schema-only migration; no production files or transactions are copied.
-- Applied to staging as migration 20261031210330.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types, avif_autodetection)
VALUES
('jauhar-pv-invoices', 'jauhar-pv-invoices', false, 5242880, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], false),
('jauhar-pv-jr', 'jauhar-pv-jr', false, 5242880, ARRAY['application/pdf']::text[], false),
('jauhar-pv-payment-initiation', 'jauhar-pv-payment-initiation', false, 5242880, ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/webp']::text[], false),
('jauhar-pv-receipts', 'jauhar-pv-receipts', false, 5242880, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], false),
('jsync-cv-receipts', 'jsync-cv-receipts', false, 10485760, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], false);
