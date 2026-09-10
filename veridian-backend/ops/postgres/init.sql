CREATE ROLE veridian_migrator LOGIN PASSWORD 'local_migration_password';
CREATE ROLE veridian_app LOGIN PASSWORD 'local_app_password';
CREATE ROLE veridian_test LOGIN PASSWORD 'local_test_password';
CREATE DATABASE veridian OWNER veridian_migrator;
CREATE DATABASE veridian_test OWNER veridian_test;
\connect veridian
GRANT CONNECT ON DATABASE veridian TO veridian_app;
GRANT USAGE ON SCHEMA public TO veridian_app;
ALTER DEFAULT PRIVILEGES FOR ROLE veridian_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO veridian_app;
ALTER DEFAULT PRIVILEGES FOR ROLE veridian_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO veridian_app;
