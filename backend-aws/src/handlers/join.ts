import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { joinClass } from '../app/join';
import { config } from '../infra/config';
import { container, nowSec } from '../infra/container';
import { HttpError } from '../domain/errors';
import { json, parseBody, wrap } from '../infra/http';
import { jwtSecret } from '../infra/secret';
import type { AthleteIdentity } from '@lmclub/contracts';

async function run(event: APIGatewayProxyEventV2, account?: { id: string; provider: AthleteIdentity['auth_provider'] }) {
  const body = parseBody<{ pin?: unknown; display_name?: unknown }>(event);
  const c = container();
  const receipt = await joinClass(
    {
      ...c,
      secret: await jwtSecret(),
      nowSec,
      athleteTokenTtlSeconds: config.athleteTokenTtlSeconds,
      rosterRetentionSeconds: config.rosterRetentionSeconds,
    },
    { pin: body.pin, displayName: body.display_name, sourceIp: event.requestContext.http.sourceIp, account },
  );
  return json(200, receipt);
}

/** POST /join (public, throttled, PIN brute-force limited). */
export const joinGuest = wrap((event) => run(event));

/** POST /join/authenticated (Cognito JWT authorizer). Account id never reaches telemetry. */
export const joinAuthenticated = wrap((event) => {
  const claims = (event.requestContext as { authorizer?: { jwt?: { claims?: Record<string, unknown> } } }).authorizer?.jwt?.claims ?? {};
  const identities = String(claims.identities ?? '');
  const provider = /apple/i.test(identities) ? 'apple' : /google/i.test(identities) ? 'google' : 'email';
  if (typeof claims.sub !== 'string') throw new HttpError(401, 'unauthorized');
  const sub = claims.sub;
  return run(event, { id: sub, provider });
});
