import { classWildcard, CONTROL_SEGMENT } from '@lmclub/contracts';
import { config } from '../infra/config';
import { verifyToken, type TokenClaims } from '../infra/jwt';
import { jwtSecret } from '../infra/secret';

/** Shape of an AWS IoT custom authorizer invocation (unsigned, MQTT or MQTT-over-WebSocket). */
export interface IotAuthorizerEvent {
  token?: string;
  protocolData?: {
    mqtt?: { username?: string; password?: string; clientId?: string };
    http?: { headers?: Record<string, string>; queryString?: string };
  };
}

export interface IotAuthorizerResult {
  isAuthenticated: boolean;
  principalId: string;
  disconnectAfterInSeconds: number;
  refreshAfterInSeconds: number;
  policyDocuments: string[];
}

const deny = (): IotAuthorizerResult => ({ isAuthenticated: false, principalId: 'anonymous', disconnectAfterInSeconds: 0, refreshAfterInSeconds: 0, policyDocuments: [] });

export function extractToken(e: IotAuthorizerEvent): string | null {
  if (e.token) return e.token;
  const qs = e.protocolData?.http?.queryString;
  const fromQuery = qs ? new URLSearchParams(qs.replace(/^\?/, '')).get('token') : null;
  if (fromQuery) return fromQuery;
  const pw = e.protocolData?.mqtt?.password; // base64 per the IoT authorizer contract
  return pw ? Buffer.from(pw, 'base64').toString('utf8') : null;
}

const iotArn = (kind: 'client' | 'topic' | 'topicfilter', resource: string): string =>
  `arn:aws:iot:${config.region}:${config.accountId}:${kind}/${resource}`;

/**
 * Least-privilege policy per principal:
 *  - athlete: publish ONLY to its own telemetry topic, receive ONLY the class control topic.
 *  - display (TV): read-only subscription to the whole class; cannot publish.
 */
export function policyFor(c: TokenClaims): object {
  const prefix = `${c.club}/${c.cls}`;
  if (c.role === 'athlete') {
    const control = `${prefix}/${CONTROL_SEGMENT}/events`;
    return {
      Version: '2012-10-17',
      Statement: [
        { Effect: 'Allow', Action: 'iot:Connect', Resource: iotArn('client', c.sub) },
        { Effect: 'Allow', Action: 'iot:Publish', Resource: iotArn('topic', `${prefix}/${c.sub}`) },
        { Effect: 'Allow', Action: 'iot:Subscribe', Resource: iotArn('topicfilter', control) },
        { Effect: 'Allow', Action: 'iot:Receive', Resource: iotArn('topic', control) },
      ],
    };
  }
  return {
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: 'iot:Connect', Resource: iotArn('client', `tv-${c.cls}-*`) },
      { Effect: 'Allow', Action: 'iot:Subscribe', Resource: iotArn('topicfilter', classWildcard(c.club, c.cls)) },
      { Effect: 'Allow', Action: 'iot:Receive', Resource: iotArn('topic', `${prefix}/*`) },
    ],
  };
}

export const handler = async (event: IotAuthorizerEvent): Promise<IotAuthorizerResult> => {
  const token = extractToken(event);
  const now = Math.floor(Date.now() / 1000);
  const claims = token ? verifyToken(token, await jwtSecret(), now) : null;
  if (!claims) return deny();

  const remaining = claims.exp - now;
  return {
    isAuthenticated: true,
    principalId: claims.sub.replace(/[^A-Za-z0-9]/g, '').slice(0, 128) || 'principal',
    disconnectAfterInSeconds: Math.min(remaining, 86_400),
    refreshAfterInSeconds: 300,
    policyDocuments: [JSON.stringify(policyFor(claims))],
  };
};
