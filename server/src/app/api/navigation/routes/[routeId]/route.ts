import { handleNavigationArtifactRequest } from '@/lib/navigation/route-http';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ routeId: string }>;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { routeId } = await context.params;
  return handleNavigationArtifactRequest(request, routeId);
}
