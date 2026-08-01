-- Tag rows that a seeder wrote, so they can be removed again.
--
-- `scripts/seed.ts --demo` fabricates usage rows so the analytics charts have
-- a shape in screenshots. Its own docstring promised that everything it created
-- was removable by `--clean-demo` — but `usage_logs` had no column to mark, so
-- cleanup could only delete the conversations and left every fabricated usage
-- row behind. `cleanDemoData` said so in a note, which made it a known,
-- documented, permanent leak rather than a bug anyone would fix.
--
-- The consequence was silent double counting: clean-demo then --demo again
-- passed the "already present?" guard (which only looked at conversations) and
-- wrote a second full set of usage rows. Spend, per-model totals and every
-- future report counted both.
--
-- NULL means "real usage", which is every row that exists today and every row
-- the application writes. Only a seeder ever sets this.

alter table public.usage_logs
  add column if not exists source text;

comment on column public.usage_logs.source is
  'NULL for real usage. Set to ''demo'' by scripts/seed.ts --demo so --clean-demo can remove exactly what it wrote.';

-- Partial index: the only query that filters on this is the cleanup, which
-- wants the handful of demo rows out of a table that is otherwise all NULLs.
-- A full index would be almost entirely dead weight.
create index if not exists usage_logs_source_idx
  on public.usage_logs (source)
  where source is not null;
