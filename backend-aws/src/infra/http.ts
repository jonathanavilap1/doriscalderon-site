import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { HttpError } from '../domain/errors';
import { verifyToken, type Role, type TokenClaims } from './jwt';
import { jwtSecret } from './secret';

export { HttpError };

export const json = (status: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode: status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

/** Maps thrown HttpErrors to responses; anything else becomes an opaque 500 (no internals, no PII in logs). */
export const wrap =
  (fn: (e: APIGatewayProxyEventV2) => Promise<APIGatewayProxyStructuredResultV2>) =>
  async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    try {
      return await fn(event);
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      console.error('unhandled', err instanceof Error ? err.name : 'unknown');
      return json(500, { error: 'internal_error' });
    }
  };

export function parseBody<T extends object>(event: APIGatewayProxyEventV2): T {
  if (!event.body) throw new HttpError(400, 'body_required');
  if (event.body.length > 4096) throw new HttpError(413, 'body_too_large');
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
    return parsed as T;
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

export interface Staff {
  sub: string;
  clubId: string;
  groups: string[];
}

/** Reads Cognito claims already validated by the API Gateway JWT authorizer. */
export function staffFrom(event: APIGatewayProxyEventV2, allowed: readonly string[]): Staff {
  const claims = (event.requestContext as { authorizer?: { jwt?: { claims?: Record<string, unknown> } } }).authorizer?.jwt?.claims;
  if (!claims || typeof claims.sub !== 'string') throw new HttpError(401, 'unauthorized');
  const rawGroups = String(claims['cognito:groups'] ?? '');
  const groups = rawGroups.replace(/[[\]]/g, '').split(/[\s,]+/).filter(Boolean);
  const clubId = claims['custom:club_id'];
  if (typeof clubId !== 'string' || !groups.some((g) => allowed.includes(g))) throw new HttpError(403, 'forbidden');
  return { sub: claims.sub, clubId, groups };
}

/** Verifies the `Authorization: Bearer` display (TV) token and that it is scoped to `classId`. */
export async function requireRoleToken(event: APIGatewayProxyEventV2, role: Role, classId: string): Promise<TokenClaims> {
  const header = event.headers.authorization ?? event.headers.Authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const claims = token ? verifyToken(token, await jwtSecret(), Math.floor(Date.now() / 1000)) : null;
  if (!claims || claims.role !== role || claims.cls !== classId) throw new HttpError(401, 'unauthorized');
  return claims;
}
