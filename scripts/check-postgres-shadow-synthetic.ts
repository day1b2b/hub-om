import type {ShadowTarget, ShadowDocument} from '../src/lib/migration/mongoShadowTransfer';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {Pool} from 'pg';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:net';
import {Prisma,PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {createPostgresShadowSnapshot} from '../src/lib/migration/postgresShadowSource.ts';
import {exportPostgresShadow} from '../src/lib/migration/postgresShadowExport.ts';
import {mongoModelNames,encodeMongoDocument,hashMongoDocument,decodeMongoDocument,type CanonicalDocument} from '../src/lib/migration/mongoDocumentCodec.ts';
import {loadMongoShadowSpool,importMongoShadowSpool} from '../src/lib/migration/mongoShadowImport.ts';
import {migratePersonalData} from './encrypt-personal-data.ts';
// This tool creates its own disposable cluster; it never consumes DATABASE_URL or .env.
if(process.argv.slice(2).join(' ')!=='--allow-disposable-local-postgres') throw new Error('Explicit disposable fixture option required');
const repo=process.cwd();
const pgBin=process.env.PG_BIN??'/opt/homebrew/opt/postgresql@18/bin';
const base=mkdtempSync('/tmp/hub-shadow-pg-');mkdirSync(base+'/socket');
const reservation=createServer();await new Promise<void>((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
const address=reservation.address();if(!address||typeof address==='string') throw new Error('PORT_RESERVATION');const port=address.port;
await new Promise<void>((resolve,reject)=>reservation.close(error=>error?reject(error):resolve()));
const pg=(name:string,args:string[])=>execFileSync(path.join(pgBin,name),args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
pg('initdb',['-D',base+'/data','-U','fixture','--auth=trust','--encoding=UTF8','--locale=C']);
let started=false;
try {
 pg('pg_ctl',['-D',base+'/data','-l',base+'/server.log','-o',`-h 127.0.0.1 -p ${port} -k ${base}/socket`,'start']);started=true;
 for(const name of ['pre_pii','post_pii']){
  pg('createdb',['-h','127.0.0.1','-p',String(port),'-U','fixture',name]);
  const migrations=readdirSync(path.join(repo,'prisma/migrations')).filter(name=>name!=='migration_lock.toml').sort();
  for(const migration of migrations){
   if(name==='pre_pii'&&(migration.includes('pii_encryption')||migration.includes('pii_activity')))continue;
   pg('psql',['-X','-h','127.0.0.1','-p',String(port),'-U','fixture','-d',name,'-v','ON_ERROR_STOP=1','-f',path.join(repo,'prisma/migrations',migration,'migration.sql')]);
  }
 }

process.env.PII_ENCRYPTION_KEYS=JSON.stringify({fixture:randomBytes(32).toString('base64')});process.env.PII_ACTIVE_KEY_ID='fixture';process.env.PII_INDEX_KEY=randomBytes(32).toString('base64');process.env.PII_ALLOW_PLAINTEXT_READS='false';
for(const database of ['pre_pii','post_pii']){
 const connectionString=`postgresql://fixture@127.0.0.1:${port}/${database}`;const pool=new Pool({connectionString});
 try{
  await pool.query('TRUNCATE companies,coaches,data_import_runs CASCADE');
  const company=randomUUID(),course=randomUUID(),operation=randomUUID(),coach=randomUUID();
  await pool.query('INSERT INTO companies(id,name,normalized_name,updated_at) VALUES($1,$2,$2,now())',[company,'SYNTHETIC-COMPANY']);
  await pool.query('INSERT INTO courses(id,company_id,course_id,course_name,revenue,updated_at) VALUES($1,$2,$3,$4,$5,now())',[course,company,'synthetic-course','SYNTHETIC-COURSE','1234.50']);
  await pool.query("INSERT INTO operation_sessions(id,operation_id,course_record_id,start_date,end_date,education_dates,updated_at,lecture_management_note,validation_errors) VALUES($1,$2,$3,'2026-09-22','2026-09-23',ARRAY['2026-09-22'::date,'2026-09-23'::date],now(),$4,'null'::jsonb)",[operation,'synthetic-operation',course,'SYNTHETIC-PRIVATE-NOTE']);
  await pool.query('INSERT INTO coaches(id,source_coach_id,name,normalized_name,updated_at) VALUES($1,$2,$3,$3,now())',[coach,'synthetic-coach','SYNTHETIC-PRIVATE-NAME']);
  await pool.query("INSERT INTO coach_private_profiles(coach_id,email,birth_date,updated_at) VALUES($1,$2,'2000-01-02',now())",[coach,'synthetic@example.test']);
  await pool.query("INSERT INTO data_import_runs(id,source_type,source_name,validation_logs) VALUES($1,'test','SYNTHETIC-PRIVATE-FILE','null'::jsonb),($2,'test','SYNTHETIC-PRIVATE-FILE2',NULL)",[randomUUID(),randomUUID()]);
  if(database==='post_pii'){const prisma=new PrismaClient({adapter:new PrismaPg({connectionString})});try{await migratePersonalData(prisma,true);}finally{await prisma.$disconnect();}}
  const snapshot=await createPostgresShadowSnapshot(pool);
  const result=await exportPostgresShadow({directory:base+'/'+database+'-spool-'+randomUUID(),sourceMode:database==='pre_pii'?'plaintext':'encrypted',snapshot,codec:{models:mongoModelNames,encode:(m,r,sourceMode)=>encodeMongoDocument(m,r,{sourceMode}),hash:hashMongoDocument}});
  const spool=await loadMongoShadowSpool(result.directory);
  const coachDocs=await spool.source.page(spool.manifest.snapshotId,'Coach',null,100);
  assert.equal(decodeMongoDocument('Coach',coachDocs[0] as CanonicalDocument).name,'SYNTHETIC-PRIVATE-NAME');
  const profiles=await spool.source.page(spool.manifest.snapshotId,'CoachPrivateProfile',null,100);
  assert.equal(decodeMongoDocument('CoachPrivateProfile',profiles[0] as CanonicalDocument).email,'synthetic@example.test');
  const operations=await spool.source.page(spool.manifest.snapshotId,'OperationSession',null,100);
  const operationPlain=decodeMongoDocument('OperationSession',operations[0] as CanonicalDocument);
  assert.equal(operationPlain.lectureManagementNote,'SYNTHETIC-PRIVATE-NOTE');assert.ok(Array.isArray(operationPlain.educationDates));assert.equal(operationPlain.educationDates.length,2);
  const courses=await spool.source.page(spool.manifest.snapshotId,'Course',null,100);
  assert.equal((decodeMongoDocument('Course',courses[0] as CanonicalDocument).revenue as Prisma.Decimal).toFixed(2),'1234.50');
  const imports=await spool.source.page(spool.manifest.snapshotId,'DataImportRun',null,100);
  const decodedImports=imports.map(d=>decodeMongoDocument('DataImportRun',d as CanonicalDocument));
  assert.ok(decodedImports.some(d=>d.validationLogs===Prisma.DbNull));assert.ok(decodedImports.some(d=>d.validationLogs===Prisma.JsonNull));
  for(const e of Object.values(spool.manifest.models)){const bytes=readFileSync(result.directory+'/'+e.file,'utf8');assert.ok(!bytes.includes('SYNTHETIC-PRIVATE'));assert.ok(!bytes.includes('synthetic@example.test'));}
  const data=new Map<string,ShadowDocument>();const key=(ns:string,m:string,id:string)=>JSON.stringify([ns,m,id]);
  const target:ShadowTarget={databaseName:'synthetic_shadow',insertOnly:async(ns,m,d)=>{const k=key(ns,m,d._id);if(data.has(k))return false;data.set(k,structuredClone(d));return true;},
   get:async(ns,m,id)=>structuredClone(data.get(key(ns,m,id))??null),
   page:async(ns,m,after,limit)=>[...data].filter(([k,d])=>{const [n,t]=JSON.parse(k);return n===ns&&t===m&&(after===null||d._id>after);}).map(([,d])=>structuredClone(d)).sort((a,b)=>a._id<b._id?-1:1).slice(0,limit),
   count:async(ns,m)=>[...data.keys()].filter(k=>{const[n,t]=JSON.parse(k);return n===ns&&t===m;}).length};
  const copied=await importMongoShadowSpool(result.directory,'synthetic_'+database,target,'production',true);
  assert.equal(copied.cutoverAuthorized,false);assert.equal(copied.referencesVerified,true);
  await importMongoShadowSpool(result.directory,'synthetic_'+database,target,'production',true);
  const cli=JSON.parse(execFileSync(process.execPath,['--experimental-strip-types','--experimental-loader','./scripts/ts-loader.mjs','scripts/export-mongodb-shadow.ts','--allow-read-only-source-export','--output-parent',base,'--source-mode',database==='pre_pii'?'plaintext':'encrypted'],{cwd:repo,env:{...process.env,DATABASE_URL:connectionString},encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  assert.equal(cli.modelCount,35);assert.equal(cli.rowCount,7);await loadMongoShadowSpool(cli.directory);
  console.log(database,'PASS',Object.keys(spool.manifest.models).length,'models',Object.values(spool.manifest.models).reduce((s,m)=>s+m.count,0),'rows');
 }catch(e){console.error(database,'FAIL',e instanceof Error?e.name:'UnknownError');process.exitCode=1;}finally{await pool.end();}
}

} finally {
 if(started) pg('pg_ctl',['-D',base+'/data','stop','-m','fast']);
 writeFileSync(base+'/README.txt','Disposable synthetic PostgreSQL cluster stopped. Generated ciphertext uses ephemeral synthetic keys; no operational credentials were loaded.\n',{mode:0o600});
 console.log('Disposable PostgreSQL verification artifacts:',base);
}
