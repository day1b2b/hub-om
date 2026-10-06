/** Current auth seam only; frozen loader remains immutable and owns original closure. */
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
export function currentAuthSeam(authURL:string){
 const root=new URL("../../../",import.meta.url).pathname;
 return registerHooks({resolve(specifier,context,next){
  if(context.parentURL?.startsWith("file:")&&fileURLToPath(context.parentURL).startsWith(root+"src/")){
   if(specifier==="@/auth")return {url:authURL,shortCircuit:true};
   if(["next/server","next/navigation","next/cache"].includes(specifier))return next(`${specifier}.js`,context);
  }
  return next(specifier,context);
 }});
}
