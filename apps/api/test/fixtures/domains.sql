-- Test-only domains. Production bootstrap intentionally creates none.
insert into stewardship_domains (name, description, is_system)
values ('Test Home', 'Fixture: household organisation', false),
       ('Test Work', 'Fixture: work organisation', false)
on conflict (name) do nothing;
