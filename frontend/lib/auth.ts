'use client';
export type BrowserSession = { user: { id: string; email?: string } } | null;
export class ApiRequestError extends Error {
  constructor(message: string, public status: number, public retryAfter = 0) { super(message); }
}
export async function api<T = any>(path: string, body: unknown = {}): Promise<T> {
  const response = await fetch('/api/'+path, { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json','X-BugHunt-Request':'1'}, body:JSON.stringify(body), signal:AbortSignal.timeout(path.startsWith('auth/')?60000:30000), cache:'no-store' });
  const data = await response.json().catch(()=>null);
  if(!response.ok){
    const wait=Number(response.headers.get('retry-after'));
    throw new ApiRequestError(data?.message || 'Connection interrupted. Please try again.',response.status,Number.isFinite(wait)&&wait>0?Math.ceil(wait):response.status===429?60:0);
  }
  return data;
}
export function clearLegacyStorage() {
  // Remove sessions persisted by older deployed versions without reading their values.
  try { for(const key of Object.keys(localStorage))if(/^sb-.*-auth-token(?:-code-verifier)?$/.test(key))localStorage.removeItem(key); } catch {}
}
export async function currentSession(): Promise<{session: BrowserSession; recovery: boolean}> {
  clearLegacyStorage();
  const fragment=new URLSearchParams(location.hash.slice(1));
  if(fragment.has('access_token')&&fragment.has('refresh_token')){
    const body={access_token:fragment.get('access_token'),refresh_token:fragment.get('refresh_token'),type:fragment.get('type')};
    history.replaceState(null,'',location.pathname+location.search);
    return api('auth/legacy-link',body);
  }
  return api('auth/session');
}
export function announceAuthChange() { window.dispatchEvent(new Event('bughunt-auth-change')); }
