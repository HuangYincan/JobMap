import { handleNavigationPlanRequest } from '@/lib/navigation/route-http';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  return handleNavigationPlanRequest(request);
}
