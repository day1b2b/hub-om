/** Parent-executed synthetic setup/readback. No schema repair, raw-business invariance per call. */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {MongoClient} from 'mongodb';
import {Prisma,type PrismaClient} from '@prisma/client';
import {ROOT,MONGO,MODELS,TABLES,company,course,opId,snapshot,canonical,type Row} from './driveImportWriterParityLiterals.fixture.ts';
import {BASELINE,manifest} from '../../../.claude/plans/mongodb-drive-import-writer/original/original-resolver.fixture.ts';
import {assertPendingSummary} from './driveImportWriterParityReview.fixture.ts';
import type {DriveImportHistoryRepository} from './driveImportHistoryRepository';
export type Backend='legacy'|'current'|'mongo';
type Model=typeof MODELS[number];
export class ParityStore {
 backend:Backend;sql?:pg.Client;prisma?:PrismaClient;client?:MongoClient;databaseName='';owned=false;history?:DriveImportHistoryRepository;
 native?:import('./mongoOperationStore').MongoOperationStore;
 constructor(backend:Backend){this.backend=backend;}
 async open(){
  const current=this.backend==='current';
  if(this.backend!=='mongo'){
   this.databaseName=current?'drive_writer_test':'drive_writer_legacy';const url=`postgresql://synthetic@127.0.0.1:56753/${this.databaseName}`;
   this.sql=new pg.Client({connectionString:url,connectionTimeoutMillis:5000,query_timeout:15000,options:'-c timezone=UTC -c statement_timeout=15000'});await this.sql.connect();
   assert.deepEqual((await this.sql.query('SELECT current_database() AS db,current_user AS usr,inet_server_port() AS port')).rows,[{db:this.databaseName,usr:'synthetic',port:56753}]);
   assert.equal((await this.sql.query('SHOW data_directory')).rows[0].data_directory,`${ROOT}/pg`);
   assert.equal((await this.sql.query('SELECT pg_try_advisory_lock(84567056753::bigint) AS owned')).rows[0].owned,true);
   assert.equal(Number((await this.sql.query('SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()')).rows[0].n),0);
   if(current){const rows=(await this.sql.query('SELECT migration_name,checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows;assert.deepEqual(rows.map(r=>({path:`prisma/migrations/${r.migration_name}/migration.sql`,sha256:r.checksum})),manifest.migrations.map(path=>({path,sha256:manifest.files.find(e=>e.originPath===path)!.sha256})));}
   else{const ledger=JSON.parse(readFileSync(`${ROOT}/migration-prefixes.json`,'utf8'));assert.equal(ledger.base,BASELINE);assert.deepEqual(ledger.databases.find((d:{database:string})=>d.database===this.databaseName).migrations,manifest.migrations.slice(0,17).map(path=>({path,sha256:manifest.files.find(e=>e.originPath===path)!.sha256})));}
   for(const table of Object.values(TABLES))assert.equal(Number((await this.sql.query(`SELECT count(*) AS n FROM "${table}"`)).rows[0].n),0,'REQUIRES_EMPTY_OWNED_TABLES');
   this.owned=true;
   if(current){process.env.DATABASE_URL=url;this.prisma=(await import('./prisma')).getPrismaClient();this.history=new (await import('./prismaDriveImportHistoryRepository')).PrismaDriveImportHistoryRepository();}
  }else{
   assert.equal(process.env.DATABASE_URL,undefined);this.client=new MongoClient(MONGO,{serverSelectionTimeoutMS:5000});await this.client.connect();
   const hello=await this.client.db('admin').command({hello:1});assert.equal(hello.setName,'drivewriter20260930');assert.equal(hello.isWritablePrimary,true);
   const server=await this.client.db('admin').command({getCmdLineOpts:1});assert.equal(server.parsed?.storage?.dbPath,`${ROOT}/mongo`);
   this.databaseName=`hub_om_shadow_drive_parity_${randomBytes(8).toString('hex')}`;
   const databases=await this.client.db('admin').command({listDatabases:1,nameOnly:true});assert.ok(Array.isArray(databases.databases));assert.equal(databases.databases.some((db:{name:string})=>db.name===this.databaseName),false,'MONGO_DATABASE_ALREADY_EXISTS');
   assert.equal((await this.client.db(this.databaseName).listCollections().toArray()).length,0);this.owned=true;
   const options={client:this.client,databaseName:this.databaseName,namespace:'shadow_drive_parity',allowShadowWrites:true as const};
   await (await import('./mongoDriveImportWriterRepository')).prepareMongoDriveImportWriter(options);
   this.native=new (await import('./mongoOperationStore')).MongoOperationStore(options,MODELS);
   this.history=await (await import('./mongoDriveImportHistoryRepository')).MongoDriveImportHistoryRepository.open(options);
  }
  await this.seed();
 }
 async seed(){
  const at=new Date('2030-01-01T00:00:00.000Z');
  if(this.backend==='legacy'){
   await this.sql!.query("INSERT INTO companies(id,name,normalized_name,updated_at) VALUES($1,'SYNTHETIC_COMPANY','synthetic_company',$2)",[company,at]);
   await this.sql!.query("INSERT INTO courses(id,company_id,course_id,course_name,updated_at) VALUES($1,$2,'SYNTHETIC_COURSE_ID','SYNTHETIC_COURSE',$3)",[course,company,at]);
   // Reverse physical insertion order separates SELECT ordering from insertion order.
   for(const i of [3,2,1,0]){const s=snapshot(i,'UTC');await this.sql!.query("INSERT INTO operation_sessions(id,operation_id,course_record_id,start_date,end_date,om_name,ld_name,drive_link,lecture_management_link,deleted_at,updated_at) VALUES($1,$2,$3,'2032-02-03','2032-02-04','SYNTHETIC_OM',NULL,$4,$5,$6,$7)",[opId(i),s.operationId,course,s.driveLink,s.lectureManagementLink,i===3?at:null,at]);}
  }else if(this.backend==='current'){
   await this.prisma!.company.create({data:{id:company,name:'SYNTHETIC_COMPANY',normalizedName:'synthetic_company'}});
   await this.prisma!.course.create({data:{id:course,companyId:company,courseId:'SYNTHETIC_COURSE_ID',name:'SYNTHETIC_COURSE'}});
   for(const i of [3,2,1,0]){const s=snapshot(i,'UTC');await this.prisma!.operationSession.create({data:{id:opId(i),courseRecordId:course,operationId:s.operationId,startDate:new Date('2032-02-03T00:00:00Z'),endDate:new Date('2032-02-04T00:00:00Z'),educationDates:[],omName:'SYNTHETIC_OM',ldName:null,driveLink:s.driveLink,lectureManagementLink:s.lectureManagementLink,deletedAt:i===3?at:null}});}
  }else{
   const {completeMongoRow}=await import('./mongoOperationStore'),{encodeMongoRuntimeDocument}=await import('./mongoRuntimeCodec');
   const insert=async(model:Model,fields:Row)=>this.native!.collection(model).insertOne(encodeMongoRuntimeDocument(model,completeMongoRow(model,{...fields,createdAt:at,updatedAt:at})));
   await insert('Company',{id:company,name:'SYNTHETIC_COMPANY',normalizedName:'synthetic_company'});
   await insert('Course',{id:course,companyId:company,courseId:'SYNTHETIC_COURSE_ID',name:'SYNTHETIC_COURSE',operationType:'NEEDS_REVIEW',processSeq:1});
   for(const i of [3,2,1,0]){const s=snapshot(i,'UTC');await insert('OperationSession',{id:opId(i),courseRecordId:course,operationId:s.operationId,startDate:new Date('2032-02-03T00:00:00Z'),endDate:new Date('2032-02-04T00:00:00Z'),educationDates:[],omName:'SYNTHETIC_OM',ldName:null,driveLink:s.driveLink,lectureManagementLink:s.lectureManagementLink,deletedAt:i===3?at:null,operationStatus:'ASSIGNMENT_NEEDED',archiveStatus:'NOT_READY',educationFormat:'NEEDS_REVIEW',operationChannel:'NEEDS_REVIEW',onsiteRequired:'UNKNOWN',hasSatisfactionSurvey:'NEEDS_REVIEW',hasResultReport:'NEEDS_REVIEW'});}
  }
 }
 async emptySelection(empty:boolean){if(this.sql)await this.sql.query('UPDATE operation_sessions SET deleted_at=$1 WHERE id=ANY($2::uuid[])',[empty?new Date('2030-01-01'):null,[opId(0),opId(1),opId(2)]]);else await this.native!.collection('OperationSession').updateMany({_id:{$in:[opId(0),opId(1),opId(2)]}},{$set:{deletedAt:empty?new Date('2030-01-01'):null}});}
 async raw(model:Model):Promise<Row[]>{return this.sql?(await this.sql.query(`SELECT * FROM "${TABLES[model]}" ORDER BY id`)).rows:this.native!.collection(model).find({}).sort({_id:1}).toArray();}
 async read(model:'DriveImportRun'|'DriveImportResult'):Promise<Row[]>{
  const rows=await this.raw(model);
  if(model==='DriveImportRun'){
   const pending=rows.filter(row=>row.status===(this.backend==='mongo'?'PENDING':'pending'));
   for(const row of pending)assertPendingSummary(row.summary);
   if(this.sql&&pending.length){const nulls=(await this.sql.query('SELECT id,summary IS NULL AS sql_null FROM drive_import_runs WHERE id=ANY($1::uuid[])',[pending.map(row=>row.id)])).rows;assert.equal(nulls.length,pending.length);for(const row of nulls)assertPendingSummary(null,row.sql_null);}
  }
  if(this.backend==='mongo'){
   const codec=await import('./mongoRuntimeCodec');
   return rows.map(row=>Object.fromEntries(Object.entries(codec.decodeMongoRuntimeDocument(model,row)).filter(([k])=>!k.endsWith('PiiIndex')).map(([k,v])=>[k,v===codec.MongoDbNull||v===codec.MongoJsonNull?null:v])));
  }
  const fields=await import('../privacy/fields');const metadata=Prisma.dmmf.datamodel.models.find(m=>m.name===model)!;
  return rows.map(raw=>{
   if(this.backend==='current')for(const [field,policy] of Object.entries(fields.privacyFields[model]?.fields??{})){
    assert.ok(fields.storedEncrypted(policy,raw[policy.storageColumn??policy.column]),`UNENCRYPTED_${model}_${field}`);
    const plain=fields.decryptField(model,field,raw[policy.storageColumn??policy.column]);if(policy.indexColumn)assert.equal(raw[policy.indexColumn],fields.indexField(model,field,plain));
   }
   return Object.fromEntries(Object.entries(raw).filter(([k])=>!k.endsWith('_pii_index')).map(([column,value])=>{
    const field=metadata.fields.find(f=>(f.dbName??f.name)===column);assert.ok(field,`UNEXPECTED_COLUMN_${column}`);let v=value;
    if(this.backend==='current'&&fields.privacyFields[model]?.fields[field.name])v=fields.decryptField(model,field.name,v);
    if(field.kind==='enum'&&v!==null){assert.equal(typeof v,'string');assert.ok(['pending','completed','completed_with_errors','failed'].includes(v as string));v=(v as string).toUpperCase();}
    return [field.name,v];
   }));
  });
 }
 async invariant(){
  // One borrowed pg.Client: serialize observer reads, without changing workflow worker schedules.
  const businessRows:Row[][]=[];for(const model of ['Company','Course','OperationSession'] as const)businessRows.push(await this.raw(model));
  const business=canonical(businessRows);
  const audit:Row[]=[];
  if(this.sql){const names=(await this.sql.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('activity_requests','activity_changes') ORDER BY table_name")).rows;for(const {table_name} of names){const rows:Row[]=(await this.sql.query(`SELECT * FROM "${table_name}" ORDER BY id`)).rows;assert.equal(rows.length,0,'CLI_AUDIT_MUST_BE_ZERO');audit.push(...rows);}}
  else{for(const name of ['ActivityRequest','ActivityChange']){const rows=await this.client!.db(this.databaseName).collection(`shadow_drive_parity_${name}`).find({}).toArray();assert.equal(rows.length,0);audit.push(...rows);}}
  return {business,audit};
 }
 async close(retain:boolean){
  try{
   if(this.owned&&!retain){
    if(this.sql){await this.sql.query('DELETE FROM drive_import_results');await this.sql.query('DELETE FROM drive_import_runs');await this.sql.query('DELETE FROM operation_sessions WHERE id=ANY($1::uuid[])',[[0,1,2,3].map(opId)]);await this.sql.query('DELETE FROM courses WHERE id=$1',[course]);await this.sql.query('DELETE FROM companies WHERE id=$1',[company]);for(const table of Object.values(TABLES))assert.equal(Number((await this.sql.query(`SELECT count(*) AS n FROM "${table}"`)).rows[0].n),0);}
    else{await this.client!.db(this.databaseName).dropDatabase();assert.equal((await this.client!.db(this.databaseName).listCollections().toArray()).length,0);}
   }
  }finally{try{await this.prisma?.$disconnect();}finally{try{await this.sql?.end();}finally{await this.client?.close();}}}
 }
}
