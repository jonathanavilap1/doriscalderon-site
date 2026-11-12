import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { config } from './config';

const client = new SecretsManagerClient({});
let cached: Promise<string> | undefined;

/** Fetched once per execution environment. Restart (or deploy) to pick up a rotated secret. */
export function jwtSecret(): Promise<string> {
  cached ??= client
    .send(new GetSecretValueCommand({ SecretId: config.secretArn }))
    .then((r) => {
      if (!r.SecretString) throw new Error('JWT secret is empty');
      return r.SecretString;
    })
    .catch((e) => {
      cached = undefined;
      throw e;
    });
  return cached;
}
