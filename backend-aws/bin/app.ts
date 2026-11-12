import { App } from 'aws-cdk-lib';
import { LmClubStack } from '../lib/lmclub-stack';

const app = new App();
const stage = app.node.tryGetContext('stage') ?? 'dev';

new LmClubStack(app, `LmClub-${stage}`, {
  stage,
  tvOrigin: app.node.tryGetContext('tvOrigin') ?? '*',
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
