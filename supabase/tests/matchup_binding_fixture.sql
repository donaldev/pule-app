-- Disposable local database ONLY. Real UUIDs are contract keys, all rows are synthetic.
begin;
insert into auth.users(id) values('20000000-0000-0000-0000-000000000099');
insert into app.groups(id,name) values('383bd6df-9050-4d1c-b48f-d2a0f3349517','Legacy hidden fixture');
insert into app.group_memberships(group_id,user_id,role) values('383bd6df-9050-4d1c-b48f-d2a0f3349517','20000000-0000-0000-0000-000000000099','owner');
insert into private.players(id,origin_group_id) values
 ('acc51043-01a0-507d-8fdd-ae0729e9fe68','383bd6df-9050-4d1c-b48f-d2a0f3349517'),
 ('5c575a65-aa80-590a-843a-0dfc7d5c1d89','383bd6df-9050-4d1c-b48f-d2a0f3349517');
insert into app.group_players(group_id,player_id,display_name) values
 ('383bd6df-9050-4d1c-b48f-d2a0f3349517','acc51043-01a0-507d-8fdd-ae0729e9fe68','Synthetic same name'),
 ('383bd6df-9050-4d1c-b48f-d2a0f3349517','5c575a65-aa80-590a-843a-0dfc7d5c1d89','Synthetic same name');
commit;
