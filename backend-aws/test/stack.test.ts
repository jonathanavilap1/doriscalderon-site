import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { LmClubStack } from '../lib/lmclub-stack';

let t: Template;
beforeAll(() => {
  const app = new App();
  t = Template.fromStack(new LmClubStack(app, 'T', { stage: 'dev', tvOrigin: 'https://tv.example.com', env: { account: '123456789012', region: 'us-east-1' } }));
}, 60_000);

describe('LM Club stack invariants', () => {
  it('writes telemetry from IoT straight into Timestream with no compute in between', () => {
    t.hasResourceProperties('AWS::IoT::TopicRule', {
      TopicRulePayload: {
        Sql: Match.stringLikeRegexp("FROM '\\+/\\+/\\+'"), // 3 levels only: never matches `_control/events`
        Actions: [Match.objectLike({ Timestream: Match.objectLike({ Dimensions: Match.arrayWith([{ Name: 'athlete_id', Value: '${topic(3)}' }]) }) })],
      },
    });
    t.resourceCountIs('AWS::IoT::TopicRule', 1);
  });

  it('expires raw beats after 30 days and keeps aggregates long-term', () => {
    const retentions = Object.values(t.findResources('AWS::Timestream::Table')).map((r) => r.Properties.RetentionProperties.MagneticStoreRetentionPeriodInDays);
    expect(retentions.sort()).toEqual(['30', '3650']);
  });

  it('PIN table uses TTL on expires_at', () => {
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [{ AttributeName: 'pin', KeyType: 'HASH' }],
      TimeToLiveSpecification: { AttributeName: 'expires_at', Enabled: true },
    });
  });

  it('encrypts every table with the customer-managed key', () => {
    for (const r of Object.values(t.findResources('AWS::DynamoDB::Table'))) {
      expect(r.Properties.SSESpecification).toMatchObject({ SSEEnabled: true, SSEType: 'KMS' });
    }
  });

  it('routes ClassCompleted from EventBridge to the results Lambda with a DLQ', () => {
    t.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: { source: ['lmclub.classes'], 'detail-type': ['ClassCompleted'] },
      Targets: [Match.objectLike({ DeadLetterConfig: Match.anyValue(), RetryPolicy: { MaximumRetryAttempts: 3, MaximumEventAgeInSeconds: 3600 } })],
    });
  });

  it('registers an unsigned IoT custom authorizer (JWT verified in the Lambda)', () => {
    t.hasResourceProperties('AWS::IoT::Authorizer', { AuthorizerName: 'lmclub-authorizer', SigningDisabled: true, Status: 'ACTIVE' });
  });

  it('only /join is public among the write routes, and it is throttled', () => {
    const routes = Object.values(t.findResources('AWS::ApiGatewayV2::Route')).map((r) => r.Properties);
    const open = routes.filter((r) => r.AuthorizationType === 'NONE').map((r) => r.RouteKey).sort();
    expect(open).toEqual(['GET /classes/{classId}', 'GET /classes/{classId}/roster', 'POST /join']);
    t.hasResourceProperties('AWS::ApiGatewayV2::Stage', { RouteSettings: Match.objectLike({ 'POST /join': Match.objectLike({ ThrottlingRateLimit: 10 }) }) });
  });

  it('log groups never retain beyond 30 days', () => {
    for (const r of Object.values(t.findResources('AWS::Logs::LogGroup'))) expect(r.Properties.RetentionInDays).toBeLessThanOrEqual(30);
  });
});
