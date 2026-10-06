import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { getCoachDbImportRepository } from "./coachDbImportRepositoryFactory";
import { readCoachDbImportSource } from "./coachDbImportSource";
export function parseCoachDbImportArgs(args:string[]){const allowed=new Set(["--dry-run","--apply"]);if(args.some(arg=>!allowed.has(arg))||args.includes("--dry-run")&&args.includes("--apply"))throw new Error("COACH_DB_IMPORT_FAILED");return{apply:args.includes("--apply")};}
export async function runCoachDbImportCommand(args:string[],env:Record<string,string|undefined>,loadEnvironment:()=>void,dependencies={readSource:readCoachDbImportSource}){
 const options=parseCoachDbImportArgs(args),scoped=getDataRepositoryOverride("coachDbImport");if(!scoped)loadEnvironment();const sourceUrl=env.COACH_DB_DATABASE_URL?.trim(),targetUrl=env.DATABASE_URL?.trim(),privacyReady=["PII_ACTIVE_KEY_ID","PII_ENCRYPTION_KEYS","PII_INDEX_KEY"].every(name=>env[name]?.trim());if(!sourceUrl||!scoped&&(!targetUrl||!privacyReady))throw new Error("COACH_DB_IMPORT_FAILED");
 try{const source=await dependencies.readSource(sourceUrl);return{options,summary:await(scoped??getCoachDbImportRepository()).importCoachData(source,options.apply,new Date())};}catch{throw new Error("COACH_DB_IMPORT_FAILED");}
}
