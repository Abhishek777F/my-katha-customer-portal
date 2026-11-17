const PROJECT_ID = "katha-777";
const FIREBASE_API_KEY = "AIzaSyCMG_broLBZ0GbYmBKge7e4vAn77aLe0PA";
const ALLOWED_ORIGIN = "https://abhishek777f.github.io";
const PORTAL_URL = "https://abhishek777f.github.io/my-katha-customer-portal/";

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? origin : "null",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin"
  };
}
function reply(data, status, origin) {
  return new Response(JSON.stringify(data), { status, headers: {
    ...cors(origin), "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0", "Pragma": "no-cache"
  }});
}
function b64url(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function pemBytes(pem) {
  const raw = atob(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,""));
  const out = new Uint8Array(raw.length); for(let i=0;i<raw.length;i++) out[i]=raw.charCodeAt(i); return out;
}
async function googleToken(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error("Cloudflare secret FIREBASE_SERVICE_ACCOUNT is missing.");
  let sa;
  try { sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT); }
  catch (_) { throw new Error("FIREBASE_SERVICE_ACCOUNT must contain the complete Firebase service-account JSON file."); }
  if (!sa || typeof sa.client_email !== "string" || !sa.client_email.includes("@") ||
      typeof sa.private_key !== "string" || !sa.private_key.includes("BEGIN PRIVATE KEY")) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is missing client_email or private_key. Paste the complete service-account JSON contents into the Cloudflare Secret value.");
  }
  const now = Math.floor(Date.now()/1000);
  const head = b64url(JSON.stringify({alg:"RS256",typ:"JWT"}));
  const claim = b64url(JSON.stringify({iss:sa.client_email,scope:"https://www.googleapis.com/auth/datastore",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600}));
  const unsigned = head+"."+claim;
  const key = await crypto.subtle.importKey("pkcs8",pemBytes(sa.private_key),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(unsigned));
  const assertion = unsigned+"."+b64url(sig);
  const r = await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion})});
  const data = await r.json(); if(!r.ok||!data.access_token) throw new Error("Google service authentication failed.");
  return data.access_token;
}
const root = () => "https://firestore.googleapis.com/v1/projects/"+PROJECT_ID+"/databases/(default)/documents";
const docUrl = (col,id) => root()+"/"+col+"/"+encodeURIComponent(id);
async function fs(url,token,options={}) {
  const r=await fetch(url,{...options,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json",...(options.headers||{})}});
  const raw=await r.text(); let data={}; try{data=raw?JSON.parse(raw):{}}catch(_){}
  if(!r.ok){const e=new Error("Firestore request failed ("+r.status+").");e.status=r.status;throw e;} return data;
}
function val(v) {
  if(!v)return null;
  if("stringValue"in v)return v.stringValue;
  if("integerValue"in v)return Number(v.integerValue);
  if("doubleValue"in v)return Number(v.doubleValue);
  if("booleanValue"in v)return v.booleanValue;
  if("timestampValue"in v)return v.timestampValue;
  if("nullValue"in v)return null;
  if("mapValue"in v)return fields(v.mapValue.fields||{});
  if("arrayValue"in v)return(v.arrayValue.values||[]).map(val);
  return null;
}
function fields(fsFields){const o={};for(const [k,v]of Object.entries(fsFields||{}))o[k]=val(v);return o;}
function enc(v){
  if(typeof v==="string")return{stringValue:v};
  if(typeof v==="boolean")return{booleanValue:v};
  if(typeof v==="number"&&Number.isInteger(v))return{integerValue:String(v)};
  if(typeof v==="number")return{doubleValue:v};
  return{nullValue:null};
}
async function getDoc(col,id,token){try{return await fs(docUrl(col,id),token)}catch(e){if(e.status===404)return null;throw e;}}
async function saveDoc(col,id,data,token,createOnly=false){
  const u=new URL(docUrl(col,id));if(createOnly)u.searchParams.set("currentDocument.exists","false");
  const f={};for(const[k,v]of Object.entries(data))f[k]=enc(v);
  return fs(u.toString(),token,{method:"PATCH",body:JSON.stringify({fields:f})});
}
async function verifyAdmin(idToken,token){
  const r=await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key="+FIREBASE_API_KEY,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({idToken})});
  const d=await r.json(),user=d.users&&d.users[0];
  if(!r.ok||!user||user.disabled===true)throw new Error("Firebase admin authentication failed.");
  const admin=await getDoc("admins",user.localId,token);
  if(!admin||fields(admin.fields).active!==true)throw new Error("This account is not an active My Katha admin.");
  return user.localId;
}
function bearer(req){const h=req.headers.get("Authorization")||"";return h.startsWith("Bearer ")?h.slice(7).trim():"";}
async function sha(token){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));return[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");}
function newToken(){return b64url(crypto.getRandomValues(new Uint8Array(32)));}
async function byCustomer(col,cid,token){
  const q={structuredQuery:{from:[{collectionId:col}],where:{fieldFilter:{field:{fieldPath:"customerId"},op:"EQUAL",value:{stringValue:cid}}}}};
  const result=await fs(root()+":runQuery",token,{method:"POST",body:JSON.stringify(q)});
  return(result||[]).filter(x=>x.document).map(x=>({id:x.document.name.split("/").pop(),...fields(x.document.fields)}));
}
const rs=n=>Number(n||0)/100;
async function portal(token,access){
  const hash=await sha(token),link=await getDoc("customerPortalLinks",hash,access);
  if(!link)return{status:401,data:{error:"Invalid or expired personal link."}};
  const l=fields(link.fields);
  if(l.revoked===true)return{status:403,data:{error:"This personal link has been revoked."}};
  if(!l.expiresAt||Date.parse(l.expiresAt)<=Date.now())return{status:401,data:{error:"This personal link has expired."}};
  const cid=String(l.customerId||"");if(!cid)return{status:401,data:{error:"Invalid personal link."}};
  const cd=await getDoc("customers",cid,access);if(!cd)return{status:404,data:{error:"Customer account not found."}};
  const c=fields(cd.fields);if(c.deleted===true)return{status:403,data:{error:"This customer account is unavailable."}};
  const [loans,pays]=await Promise.all([byCustomer("loans",cid,access),byCustomer("payments",cid,access)]);
  const products=loans.filter(x=>x.status==="active").map(x=>({name:x.name||"Product",quantity:x.qty??0,amount:rs(x.qty?Math.round(Number(x.totalPaise||0)/Number(x.qty)):Number(x.totalPaise||0)),date:x.date||x.createdAt||null,total:rs(x.totalPaise||0)}));
  const payments=pays.filter(x=>x.status==="active").map(x=>({date:x.paymentDate||x.createdAt||null,amount:rs(x.amountPaise||0),method:x.method==="CASH"?"Cash":(x.method||"Payment"),status:"Received",reference:x.receiptNo||""}));
  products.sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
  payments.sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
  return{status:200,data:{customer:{name:c.name||"",id:cid,accountDate:c.createdAt||null,mobile:c.mobile||"",address:c.address||""},business:{name:"Balappa Provision Store"},summary:{totalAmount:rs(c.totalPaise||0),totalPaid:rs(c.paidPaise||0),balance:rs((c.totalPaise||0)-(c.paidPaise||0))},products,payments}};
}
async function handle(req,env){
  const origin=req.headers.get("Origin")||"";
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(origin)});
  const path=new URL(req.url).pathname;
  try{
    // Public health checks expose service status only, never customer data.
    if(req.method==="GET"&&path.endsWith("/health"))return reply({service:"My Katha Customer Portal API",project:PROJECT_ID,status:"ready"},200,origin);
    // Verify the configured service account and its Firestore read access without returning records.
    if(req.method==="GET"&&path.endsWith("/health/firebase")){
      const access=await googleToken(env);
      await fs(root()+":runQuery",access,{method:"POST",body:JSON.stringify({structuredQuery:{from:[{collectionId:"customers"}],limit:1}})});
      return reply({firebase:"connected",firestore:"readable",project:PROJECT_ID},200,origin);
    }
    // All customer and admin API routes remain restricted to the GitHub Pages origin.
    if(origin!==ALLOWED_ORIGIN)return reply({error:"Origin not allowed."},403,origin);
    if(req.method==="GET"&&path.endsWith("/portal")){
      const token=bearer(req);if(token.length<30)return reply({error:"Personal link token required."},401,origin);
      const result=await portal(token,await googleToken(env));return reply(result.data,result.status,origin);
    }
    if(req.method==="POST"&&path.endsWith("/admin/create-link")){
      const idToken=bearer(req);if(!idToken)return reply({error:"Admin sign-in required."},401,origin);
      const body=await req.json(),cid=String(body.customerId||"").trim(),days=Math.max(1,Math.min(365,Number(body.expiresInDays||90)));
      if(!/^ABHI\d{3,}$/i.test(cid))return reply({error:"Invalid customer ID."},400,origin);
      const access=await googleToken(env),uid=await verifyAdmin(idToken,access),customer=await getDoc("customers",cid,access);
      if(!customer||fields(customer.fields).deleted===true)return reply({error:"Active customer not found."},404,origin);
      const token=newToken(),hash=await sha(token),expiresAt=new Date(Date.now()+days*86400000).toISOString();
      await saveDoc("customerPortalLinks",hash,{customerId:cid,revoked:false,expiresAt,createdAt:new Date().toISOString(),createdBy:uid},access,true);
      return reply({customerId:cid,link:PORTAL_URL+"?t="+encodeURIComponent(token),linkId:hash,expiresAt},201,origin);
    }
    if(req.method==="POST"&&path.endsWith("/admin/revoke-link")){
      const idToken=bearer(req);if(!idToken)return reply({error:"Admin sign-in required."},401,origin);
      const body=await req.json(),linkId=String(body.linkId||"").trim();
      if(!/^[a-f0-9]{64}$/.test(linkId))return reply({error:"Invalid link ID."},400,origin);
      const access=await googleToken(env);await verifyAdmin(idToken,access);
      const old=await getDoc("customerPortalLinks",linkId,access);if(!old)return reply({error:"Link not found."},404,origin);
      const d=fields(old.fields);
      await saveDoc("customerPortalLinks",linkId,{customerId:d.customerId||"",revoked:true,expiresAt:d.expiresAt||new Date(0).toISOString(),createdAt:d.createdAt||new Date().toISOString(),createdBy:d.createdBy||""},access);
      return reply({success:true},200,origin);
    }
    return reply({error:"Not found."},404,origin);
  }catch(e){return reply({error:e.message||"Server error."},500,origin);}
}
export default {fetch:handle};
