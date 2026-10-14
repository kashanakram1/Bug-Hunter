// Configure provider templates only; never sends email or prints credentials.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {parseEnv} from 'node:util';
const root=new URL('../../',import.meta.url);
const env=parseEnv(readFileSync(new URL('.env',root),'utf8'));
if(env.SUPABASE_PROJECT_REF!=='kcxswqcuqxrlukxtpzlz')throw Error('Unexpected project; no change made.');
const endpoint=`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/config/auth`;
const headers={Authorization:'Bearer '+env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'};
async function request(method,body){const r=await fetch(endpoint,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Email configuration failed: HTTP '+r.status);return r.json();}
const patch={mailer_otp_length:8,mailer_otp_exp:600,mailer_subjects_confirmation:'Bug Hunter — confirm your email with a code',mailer_subjects_recovery:'Bug Hunter — password reset code',mailer_templates_confirmation_content:readFileSync(new URL('backend/supabase/templates/confirmation.html',root),'utf8'),mailer_templates_recovery_content:readFileSync(new URL('backend/supabase/templates/recovery.html',root),'utf8')};
const before=await request('GET');
if(before.mailer_autoconfirm!==false||before.smtp_host!=='smtp-relay.brevo.com'||before.rate_limit_email_sent!==50)throw Error('Unexpected email configuration; review required before changing it.');
mkdirSync(new URL('private/',root),{recursive:true});
writeFileSync(new URL(`private/email-template-backup-${Date.now()}.json`,root),JSON.stringify(Object.fromEntries(Object.keys(patch).map(k=>[k,before[k]])),null,2));
await request('PATCH',patch);
const after=await request('GET');
if(Object.keys(patch).some(k=>after[k]!==patch[k]))throw Error('Saved email templates do not match.');
for(const key of ['smtp_host','smtp_port','smtp_user','smtp_admin_email','rate_limit_email_sent','mailer_autoconfirm','password_min_length','site_url'])if(after[key]!==before[key])throw Error('Unrelated setting changed; review '+key);
console.log(JSON.stringify({configured:true,code_digits:after.mailer_otp_length,expires_seconds:after.mailer_otp_exp,email_limit_per_hour:after.rate_limit_email_sent,confirmation_required:!after.mailer_autoconfirm}));
