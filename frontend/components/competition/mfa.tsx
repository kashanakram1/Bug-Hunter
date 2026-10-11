'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '@/lib/auth';
import { ErrorBox, Loading } from './common';

export function StaffMfa({ children }: { children: React.ReactNode }) {
  const [state,setState]=useState<any>(null),[enrollment,setEnrollment]=useState<any>(null),[qr,setQr]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const load=()=>api('auth/mfa/status').then(setState).catch(e=>setError(e.message));
  useEffect(()=>{void load();},[]);
  async function enroll(){setBusy(true);setError('');try{const e=await api('auth/mfa/enroll');setEnrollment(e);setQr(await QRCode.toDataURL(e.uri,{width:240,margin:2,color:{dark:'#111111',light:'#eeeae4'}}));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function verify(event:React.FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');try{await api('auth/mfa/verify',{factorId:enrollment?.id||state?.factors[0]?.id,code:String(new FormData(event.currentTarget).get('code')||'')});setEnrollment(null);setQr('');await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  if(state?.verified)return children;
  return <section className="panel padded"><span className="eyebrow">STAFF SECURITY</span><h1>{state?.factors?.length?'Verify your authenticator':'Set up your authenticator'}</h1><p>Organizer and judging access requires a six-digit code from an authenticator app. Keep this account and its setup key private.</p><ErrorBox error={error}/>{!state&&!error?<Loading/>:null}{state&&!state.factors.length&&!enrollment?<button className="btn" disabled={busy} onClick={enroll}>Set up authenticator</button>:null}{enrollment?<><p>Scan this code with your authenticator app, or enter the setup key manually.</p>{qr?<img src={qr} width={240} height={240} alt="Authenticator setup QR code"/>:null}<p>Setup key: <code>{enrollment.secret}</code></p></>:null}{enrollment||state?.factors?.length?<form onSubmit={verify}><label className="field">Authenticator code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required/></label><button className="btn" disabled={busy}>{busy?'Verifying…':'Verify and continue'}</button></form>:null}<p className="muted">If you lose your authenticator, contact the event operator for identity verification and account recovery. Email password resets do not bypass this requirement.</p></section>;
}
