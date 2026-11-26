// nuglyan: admin-only metadata adapter. No external dependencies.
const origin = new Set(["https://kinoteka-veroniki.waxencream256.chatgpt.site","https://kekkka.github.io"]);
const normalize = (v: unknown) => typeof v === "string" ? v.normalize("NFKC").toLowerCase().replace(/ё/g,"е").replace(/[^\p{L}\p{N}]+/gu," ").trim() : "";
const cleanText=(v:unknown)=>typeof v==="string"?v:null;
const num=(v:unknown)=>typeof v==="number"&&Number.isFinite(v)?v:null;
const rating=(v:unknown)=>{const n=typeof v==="number"?v:typeof v==="string"?Number(v):NaN;return Number.isFinite(n)&&n>0&&n<=10?n:null;};
const url=(v:unknown)=>{try{const u=new URL(String(v));return u.protocol==="https:"?u.href:null;}catch{return null;}};
const names=(v:unknown)=>Array.isArray(v)?v.flatMap(x=>typeof x?.name==="string"?[x.name]:[]):[];
const matchesKind=(m:any,expected:boolean|null,allowUnknown=false)=>{
 if(expected===null)return true;
 const type=String(m?.type||"").toLowerCase();
 if(["tv-series","animated-series"].includes(type))return expected===true;
 if(["movie","cartoon"].includes(type))return expected===false;
 if(typeof m?.isSeries==="boolean")return m.isSeries===expected;
 return allowUnknown;
};
const identityIssue=(m:any,id:number,year:number|null,series:boolean|null,title:string)=>{
 if(m?.id!==id)return "provider_id_mismatch";
 if(year!==null&&m?.year!==year)return "provider_year_mismatch";
 if(!matchesKind(m,series,true))return "provider_kind_mismatch";
 if(![m?.name,m?.alternativeName,m?.enName].some(n=>normalize(n)===normalize(title)))return "provider_title_mismatch";
 return null;
};

const watchOrigin="https://g1b-13ngdzu.troutcdn.site";
async function findWatchUrl(id:number,title:string):Promise<string|null>{
 try{
  const r=await fetch(watchOrigin+"/"+id,{headers:{"Accept":"text/html"},signal:AbortSignal.timeout(6500),redirect:"follow"});
  if(!r.ok)return null;
  const final=new URL(r.url);
  const path=final.pathname.endsWith("/")?final.pathname.slice(0,-1):final.pathname;
  if(final.origin!==watchOrigin||path!=="/"+id)return null;
  const html=(await r.text()).slice(0,200000);
  const wanted=normalize(title),page=normalize(html);
  if(!wanted||!page.includes(wanted))return null;
  return watchOrigin+"/"+id;
 }catch{return null;}
}

const fields=(m:any)=>({kinopoiskId:m.id,imdbId:cleanText(m.externalId?.imdb),title:cleanText(m.name),originalTitle:cleanText(m.alternativeName),year:num(m.year),type:cleanText(m.type),isSeries:typeof m.isSeries==="boolean"?m.isSeries:null,posterUrl:url(m.poster?.url),synopsis:cleanText(m.description),genres:names(m.genres),countries:names(m.countries),kinopoiskRating:rating(m.rating?.kp),imdbRating:rating(m.rating?.imdb),durationMinutes:num(m.movieLength),actors:Array.isArray(m.persons)?m.persons.filter((x:any)=>x?.enProfession==="actor").slice(0,20).map((x:any)=>cleanText(x.name)??cleanText(x.enName)).filter(Boolean):[]});
Deno.serve(async(req)=>{
 const o=req.headers.get("origin")??"";
 const headers:Record<string,string>={"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS"};
 if(origin.has(o))headers["Access-Control-Allow-Origin"]=o;
 const out=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return out(405,{error:"method"});
 if(o&&!origin.has(o))return out(403,{error:"origin"});
 const auth=req.headers.get("authorization")??"";
 if(!/^Bearer \S+$/i.test(auth))return out(401,{error:"auth_required"});
 const base=Deno.env.get("SUPABASE_URL"), key=Deno.env.get("SUPABASE_ANON_KEY");
 if(!base||!key)return out(503,{error:"server_config"});
 const db=async(path:string,init:RequestInit={})=>{
  const r=await fetch(base+"/rest/v1/"+path,{...init,headers:{apikey:key,Authorization:auth,"Content-Type":"application/json",...(init.headers as Record<string,string>??{})},signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw new Error("database_"+r.status);
  const raw=await r.text();
  if(!raw.trim())return null;
  try{return JSON.parse(raw);}catch{throw new Error("database_invalid_json");}
 };
 try{
  let admin;try{admin=await db("rpc/kinoteka_is_admin",{method:"POST",body:"{}"});}catch{return out(401,{error:"auth_failed"});}
  if(admin!==true)return out(403,{error:"admin_required"});
  const raw=await req.text();if(raw.length>4096)return out(413,{error:"request_too_large"});
  let b:any;try{b=JSON.parse(raw);}catch{return out(400,{error:"invalid_json"});}
  if(!b||typeof b!=="object")return out(400,{error:"invalid_json"});
  const token=Deno.env.get("POISKKINO_API_KEY");
  if(!token)return out(503,{error:"provider_secret_missing"});
  const provider=async(path:string)=>{
   let last="provider_empty_response";
   for(let attempt=0;attempt<2;attempt++){
    const reserved=await db("rpc/kinoteka_reserve_metadata_request",{method:"POST",body:"{}"});
    if(reserved!==true)throw new Error("budget_exhausted");
    try{
     const r=await fetch("https://eu-api.poiskkino.dev/v1.5/"+path,{headers:{"X-API-KEY":token,"Accept":"application/json"},signal:AbortSignal.timeout(15000),redirect:"error"});
     if(!r.ok){
      const code="provider_"+r.status;
      if((r.status===429||r.status>=500)&&attempt<1){last=code;await new Promise(resolve=>setTimeout(resolve,350*(attempt+1)));continue;}
      throw new Error(code);
     }
     const raw=await r.text();
     if(!raw.trim())throw new Error("provider_empty_response");
     try{return JSON.parse(raw);}catch{throw new Error("provider_invalid_json");}
    }catch(e){
     const code=e instanceof Error?e.message:"provider_network";
     const retryable=code==="provider_empty_response"||code==="provider_invalid_json"||code==="provider_network"||code==="TimeoutError"||code==="TypeError"||code==="provider_429"||/^provider_5\d\d$/.test(code);
     if(!retryable||attempt>=1)throw e;
     last=code;await new Promise(resolve=>setTimeout(resolve,350*(attempt+1)));
    }
   }
   throw new Error(last);
  };
  // One counted request for connectivity test; never return the token.
  if(b.action==="health"){const m=await provider("movie/447301");return out(200,{ok:true,provider:"poiskkino",sampleId:m.id??null});}
  if(!["search","select","refresh"].includes(b.action))return out(400,{error:"invalid_action"});
  if(typeof b.entryId!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.entryId))return out(400,{error:"invalid_entry"});
  const id=b.entryId;
  const rows=await db("kinoteka_entries?id=eq."+id+"&select=id,title,version");
  const entry=rows[0];if(!entry)return out(404,{error:"entry_missing"});
  const year=Number.isInteger(b.year)&&b.year>=1880&&b.year<=2100?b.year:null;
  const series=typeof b.isSeries==="boolean"?b.isSeries:null;
  const cache=(await db("kinoteka_metadata?entry_id=eq."+id+"&select=*"))[0];
  const fingerprint=JSON.stringify([entry.title,year,series]);
  const save=async(status:string,metadata:unknown,providerId:number|null)=>{
   const current=(await db("kinoteka_entries?id=eq."+id+"&select=version"))[0];
   if(!current||current.version!==entry.version)throw new Error("version_conflict");
   await db("kinoteka_metadata?on_conflict=entry_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({entry_id:id,status,metadata,provider_id:providerId,fetched_at:status==="ready"?new Date().toISOString():null,last_error:null,updated_at:new Date().toISOString()})});
  };
  if(b.action==="refresh"){
   if(!Number.isSafeInteger(b.providerId)||b.providerId<=0)return out(400,{error:"invalid_provider_id"});
   let detail=await provider("movie/"+b.providerId);
   const issue=identityIssue(detail,b.providerId,year,series,entry.title);
   if(issue){
    if(issue==="provider_id_mismatch")throw new Error(issue);
    const data=await provider("movie/search?limit=10&query="+encodeURIComponent(entry.title.slice(0,200)));
    if(!Array.isArray(data.docs))throw new Error("provider_schema");
    const exact=data.docs.filter((m:any)=>Number.isSafeInteger(m.id)&&m.id>0&&[m.name,m.alternativeName,m.enName].some(n=>normalize(n)===normalize(entry.title))&&matchesKind(m,series,false)&&(year===null||m.year===year));
    if(exact.length!==1){
     const candidates=data.docs.filter((m:any)=>Number.isSafeInteger(m.id)&&m.id>0).map(fields);
     await save("needs_review",{fingerprint,candidates,reason:issue,checkedAt:new Date().toISOString()},null);
     return out(200,{status:"needs_review",reason:issue,candidates});
    }
    const candidate=exact[0];
    detail=await provider("movie/"+candidate.id);
    const replacementIssue=identityIssue(detail,candidate.id,year,series,entry.title);
    if(replacementIssue)throw new Error(replacementIssue);
   }
   const metadata={...fields(detail),watchUrl:await findWatchUrl(detail.id,detail.name),fingerprint,fetchedAt:new Date().toISOString()};
   await save("ready",metadata,detail.id);return out(200,{status:"ready",metadata,relinked:detail.id!==b.providerId});
  }
  if(b.action==="search"){
   if(cache?.status==="ready"&&cache.metadata?.fingerprint===fingerprint&&Date.now()-Date.parse(cache.fetched_at)<30*86400000)return out(200,{status:"ready",cached:true,metadata:cache.metadata});
   if(cache?.status==="needs_review"&&cache.metadata?.fingerprint===fingerprint&&Array.isArray(cache.metadata?.candidates)&&Date.now()-Date.parse(cache.updated_at)<86400000)return out(200,{status:"needs_review",cached:true,candidates:cache.metadata.candidates});
   const data=await provider("movie/search?limit=10&query="+encodeURIComponent(entry.title.slice(0,200)));
   if(!Array.isArray(data.docs))throw new Error("provider_schema");
   const candidates=data.docs.filter((m:any)=>Number.isSafeInteger(m.id)&&m.id>0).map(fields);
   const exact=data.docs.filter((m:any)=>Number.isSafeInteger(m.id)&&m.id>0&&[m.name,m.alternativeName,m.enName].some(n=>normalize(n)===normalize(entry.title))&&series!==null&&matchesKind(m,series,false)&&(year===null||m.year===year));
   if(exact.length===1){
    const detail=await provider("movie/"+exact[0].id);
    if(detail.id!==exact[0].id||(year!==null&&detail.year!==year)||!matchesKind(detail,series,true)||![detail.name,detail.alternativeName,detail.enName].some(n=>normalize(n)===normalize(entry.title)))throw new Error("provider_identity_mismatch");
    const metadata={...fields(detail),watchUrl:await findWatchUrl(detail.id,detail.name),fingerprint,fetchedAt:new Date().toISOString()};await save("ready",metadata,detail.id);return out(200,{status:"ready",metadata});
   }
   await save("needs_review",{fingerprint,candidates},null);return out(200,{status:"needs_review",candidates});
  }
  if(!Number.isSafeInteger(b.providerId)||b.providerId<=0)return out(400,{error:"invalid_provider_id"});
  if(cache?.status!=="needs_review"||cache.metadata?.fingerprint!==fingerprint||!cache.metadata?.candidates?.some((x:any)=>x.kinopoiskId===b.providerId))return out(409,{error:"select_from_current_candidates"});
  const m=await provider("movie/"+b.providerId);if(m.id!==b.providerId||(year!==null&&m.year!==year)||!matchesKind(m,series,true)||![m.name,m.alternativeName,m.enName].some(n=>normalize(n)===normalize(entry.title)))throw new Error("provider_identity_mismatch");
  const metadata={...fields(m),watchUrl:await findWatchUrl(m.id,m.name),fingerprint,fetchedAt:new Date().toISOString()};await save("ready",metadata,m.id);return out(200,{status:"ready",metadata});
 }catch(e){const code=e instanceof Error?e.message:"unexpected";console.error("nuglyan-metadata request failed",code);const safe=/^(budget_exhausted|provider_\d{3}|provider_schema|provider_identity_mismatch|provider_(?:empty_response|invalid_json|network|id_mismatch|year_mismatch|kind_mismatch|title_mismatch)|version_conflict|database_\d{3}|database_invalid_json)$/.test(code)?code:"request_failed";return out(safe==="budget_exhausted"?429:safe==="version_conflict"?409:502,{error:safe});}
});
