import { handleWebApi } from '../../../../backend/src/web-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return handleWebApi(request, (await context.params).path.join('/'));
}
export const POST = handle;
export const GET = handle;
