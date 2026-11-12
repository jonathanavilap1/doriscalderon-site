import { CfnOutput, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as iot from 'aws-cdk-lib/aws-iot';
import { Effect, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { IKey } from 'aws-cdk-lib/aws-kms';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import * as ts from 'aws-cdk-lib/aws-timestream';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

export const RAW_RETENTION_DAYS = 30;
export const AGG_RETENTION_DAYS = 3650;

/**
 * Real-time layer: Timestream (raw + aggregate tables) and the IoT Rule that writes telemetry
 * straight into it with no intermediate compute.
 */
export class Telemetry extends Construct {
  readonly databaseName: string;
  readonly rawTableName: string;
  readonly aggTableName: string;
  readonly rawTable: ts.CfnTable;
  readonly aggTable: ts.CfnTable;
  readonly iotEndpoint: string;

  constructor(scope: Construct, id: string, props: { key: IKey; isProd: boolean }) {
    super(scope, id);
    const stack = Stack.of(this);
    const removal = props.isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    const db = new ts.CfnDatabase(this, 'Db', { kmsKeyId: props.key.keyArn });
    db.applyRemovalPolicy(removal);
    this.databaseName = db.ref;

    // Lifecycle: raw per-second beats auto-expire after 30 days. Before that the class-completed Lambda
    // has already written per-minute aggregates into the long-retention table (see class-completed.ts).
    this.rawTable = new ts.CfnTable(this, 'RawTable', {
      databaseName: db.ref,
      retentionProperties: { MemoryStoreRetentionPeriodInHours: '24', MagneticStoreRetentionPeriodInDays: String(RAW_RETENTION_DAYS) },
    });
    this.rawTable.addResourceDependency(db);
    this.rawTable.applyRemovalPolicy(removal);
    this.rawTableName = this.rawTable.attrName;

    this.aggTable = new ts.CfnTable(this, 'AggTable', {
      databaseName: db.ref,
      // 72h memory window keeps a replayed (dead-lettered) ClassCompleted event writable.
      retentionProperties: { MemoryStoreRetentionPeriodInHours: '72', MagneticStoreRetentionPeriodInDays: String(AGG_RETENTION_DAYS) },
    });
    this.aggTable.addResourceDependency(db);
    this.aggTable.applyRemovalPolicy(removal);
    this.aggTableName = this.aggTable.attrName;

    // IoT Core endpoint (MQTT over WebSockets on 443).
    const describe = new AwsCustomResource(this, 'IotEndpoint', {
      onUpdate: {
        service: 'Iot',
        action: 'describeEndpoint',
        parameters: { endpointType: 'iot:Data-ATS' },
        physicalResourceId: PhysicalResourceId.of('iot-data-ats-endpoint'),
      },
      installLatestAwsSdk: false,
      policy: AwsCustomResourcePolicy.fromStatements([new PolicyStatement({ actions: ['iot:DescribeEndpoint'], resources: ['*'] })]),
    });
    this.iotEndpoint = describe.getResponseField('endpointAddress');

    const ruleRole = new Role(this, 'RuleRole', { assumedBy: new ServicePrincipal('iot.amazonaws.com') });
    ruleRole.addToPolicy(new PolicyStatement({ actions: ['timestream:WriteRecords'], resources: [this.rawTable.attrArn] }));
    ruleRole.addToPolicy(new PolicyStatement({ actions: ['timestream:DescribeEndpoints'], resources: ['*'] }));
    props.key.grantEncryptDecrypt(ruleRole);

    const errors = new LogGroup(this, 'RuleErrors', { retention: RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY });
    ruleRole.addToPolicy(new PolicyStatement({ effect: Effect.ALLOW, actions: ['logs:CreateLogStream', 'logs:PutLogEvents'], resources: [errors.logGroupArn] }));

    // Topic hierarchy: {clubID}/{classID}/{athleteUUID}. `+/+/+` deliberately does NOT match the 4-level
    // `_control/events` topic, so server events never land in Timestream.
    // The WHERE clause drops physiologically impossible readings before they are stored.
    new iot.CfnTopicRule(this, 'TelemetryToTimestream', {
      ruleName: `lmclub_telemetry_${stack.stackName.replace(/[^A-Za-z0-9_]/g, '_')}`,
      topicRulePayload: {
        sql: "SELECT bpm, effort_pct, seq, source FROM '+/+/+' WHERE bpm >= 30 AND bpm <= 240",
        awsIotSqlVersion: '2016-03-23',
        ruleDisabled: false,
        actions: [
          {
            timestream: {
              roleArn: ruleRole.roleArn,
              databaseName: db.ref,
              tableName: this.rawTable.attrName,
              dimensions: [
                { name: 'club_id', value: '${topic(1)}' },
                { name: 'class_id', value: '${topic(2)}' },
                { name: 'athlete_id', value: '${topic(3)}' },
              ],
              // Broker arrival time: device clocks are untrusted and Timestream rejects out-of-window records.
              timestamp: { unit: 'MILLISECONDS', value: '${timestamp()}' },
            },
          },
        ],
        errorAction: { cloudwatchLogs: { logGroupName: errors.logGroupName, roleArn: ruleRole.roleArn } },
      },
    });

    new CfnOutput(this, 'IotEndpointOutput', { value: this.iotEndpoint });
  }
}
