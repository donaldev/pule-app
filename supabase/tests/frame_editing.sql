create table test.frame_edit_case(data jsonb);
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
do $$
declare
 a jsonb; sid uuid; fid uuid; first_frame uuid; rev bigint;
 p1 uuid:='30000000-0000-0000-0000-000000000001'; p2 uuid:='30000000-0000-0000-0000-000000000002';
begin
 a:=app.start_session(gen_random_uuid(),'10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',array[p1,p2],p1);
 sid:=(a#>>'{session,id}')::uuid;
 for i in 1..12 loop
 rev:=(a#>>'{session,revision}')::bigint;
 a:=app.start_frame(gen_random_uuid(),sid,rev,array[p1,p2],p1);
 fid:=(a->'frames'->(i-1)->>'id')::uuid;
 if i=1 then first_frame:=fid; end if;
 a:=app.complete_frame(gen_random_uuid(),sid,(a#>>'{session,revision}')::bigint,fid,p1,0,0,false,'regular');
 end loop;
 a:=app.correct_frame(gen_random_uuid(),sid,(a#>>'{session,revision}')::bigint,first_frame,p2,2,1,'Frame one correction after twelve frames');
 perform test.ok((a->'scores'->>p1::text)::int=11 and (a->'scores'->>p2::text)::int=1,'old-frame correction recalculates ongoing scores');
 perform test.ok(exists(select 1 from jsonb_array_elements(a->'standings') x where x->>'player_id'=p2::text and (x->>'frames_won')::int=1),'derived standings updated');
 perform test.ok((select foul_count=2 from app.frame_participants where frame_id=first_frame and side=1),'old-frame foul correction saved');
 perform set_config('test.frame_edit_case',jsonb_build_object('session',sid,'frame',first_frame,'revision',(a#>>'{session,revision}')::bigint)::text,false);
end $$;
reset role;
insert into test.frame_edit_case values(current_setting('test.frame_edit_case')::jsonb);
