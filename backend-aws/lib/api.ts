import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { CorsHttpMethod, CfnStage, HttpApi, HttpMethod, HttpStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import * as iot from 'aws-cdk-lib/aws-iot';
import { Architecture, IFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Persistence } from './persistence';
import { Telemetry } from './telemetry';

const HANDLERS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'handlers');
export const AUTHORIZER_NAME = 'lmclub-authorizer';

export interface ApiProps {
  persistence: Persistence;
  telemetry: Telemetry;
  tvOrigin: string;
  isProd: boolean;
}

export class Api extends Construct {
  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);
    const stack = Stack.of(this);
    const { persistence: p, telemetry: t } = props;
    const removal = props.isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    const jwtSecret = new Secret(this, 'JwtSecret', {
      description: 'HS256 key for athlete/TV realtime tokens',
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
    });
    const bus = new EventBus(this, 'Bus', { eventBusName: `lmclub-${stack.stackName}` });

    const env = {
      ACCOUNT_ID: stack.account,
      JWT_SECRET_ARN: jwtSecret.secretArn,
      IOT_ENDPOINT: t.iotEndpoint,
      IOT_AUTHORIZER_NAME: AUTHORIZER_NAME,
      EVENT_BUS_NAME: bus.eventBusName,
      PINS_TABLE: p.pins.tableName,
      CLASSES_TABLE: p.classes.tableName,
      CLUBS_TABLE: p.clubs.tableName,
      ROSTER_TABLE: p.roster.tableName,
      HISTORY_TABLE: p.history.tableName,
      TS_DATABASE: t.databaseName,
      TS_RAW_TABLE: t.rawTableName,
      TS_AGG_TABLE: t.aggTableName,
      NODE_OPTIONS: '--enable-source-maps',
    };

    const fn = (name: string, file: string, handler: string, opts: { timeout?: number; memory?: number } = {}): NodejsFunction =>
      new NodejsFunction(this, name, {
        entry: path.join(HANDLERS, `${file}.ts`),
        handler,
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: opts.memory ?? 256,
        timeout: Duration.seconds(opts.timeout ?? 10),
        environment: env,
        // 30-day log retention: logs must never become a long-lived PII store.
        logGroup: new LogGroup(this, `${name}Logs`, { retention: RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY }),
        bundling: { minify: true, sourceMap: true, target: 'node22' },
      });

    const authorizerFn = fn('AuthorizerFn', 'authorizer', 'handler', { timeout: 5 });
    const joinGuest = fn('JoinGuestFn', 'join', 'joinGuest');
    const joinAuth = fn('JoinAuthFn', 'join', 'joinAuthenticated');
    const createClass = fn('CreateClassFn', 'classes', 'createClass');
    const rotatePin = fn('RotatePinFn', 'classes', 'rotatePin');
    const endClass = fn('EndClassFn', 'classes', 'endClass');
    const getClass = fn('GetClassFn', 'classes', 'getClass');
    const getRoster = fn('GetRosterFn', 'classes', 'getRoster');
    const putBranding = fn('PutBrandingFn', 'admin', 'putBranding');
    const overrideName = fn('OverrideNameFn', 'admin', 'overrideName');
    const completed = fn('ClassCompletedFn', 'class-completed', 'handler', { timeout: 60, memory: 512 });

    // ---- IAM (least privilege per function) ----
    const publishControl = new PolicyStatement({
      actions: ['iot:Publish', 'iot:RetainPublish'],
      resources: [`arn:aws:iot:${stack.region}:${stack.account}:topic/*/*/_control/events`],
    });
    for (const f of [authorizerFn, joinGuest, joinAuth, createClass, getClass, getRoster, endClass]) jwtSecret.grantRead(f);
    jwtSecret.grantRead(completed);
    for (const f of [joinGuest, joinAuth, endClass, overrideName, completed]) f.addToRolePolicy(publishControl);

    p.pins.grantReadWriteData(joinGuest);
    p.pins.grantReadWriteData(joinAuth);
    for (const f of [joinGuest, joinAuth]) {
      p.classes.grantReadData(f);
      p.clubs.grantReadData(f);
      p.roster.grantReadWriteData(f);
    }
    p.pins.grantReadWriteData(createClass);
    p.classes.grantReadWriteData(createClass);
    p.clubs.grantReadData(createClass);
    p.pins.grantReadWriteData(rotatePin);
    p.classes.grantReadWriteData(rotatePin);
    p.classes.grantReadWriteData(endClass);
    p.pins.grantWriteData(endClass);
    bus.grantPutEventsTo(endClass);
    p.classes.grantReadData(getClass);
    p.clubs.grantReadData(getClass);
    p.roster.grantReadData(getRoster);
    p.clubs.grantReadWriteData(putBranding);
    p.classes.grantReadData(overrideName);
    p.roster.grantReadWriteData(overrideName);
    p.roster.grantReadData(completed);
    p.history.grantWriteData(completed);
    completed.addToRolePolicy(new PolicyStatement({ actions: ['timestream:Select'], resources: [t.rawTable.attrArn] }));
    completed.addToRolePolicy(new PolicyStatement({ actions: ['timestream:WriteRecords'], resources: [t.aggTable.attrArn] }));
    completed.addToRolePolicy(new PolicyStatement({ actions: ['timestream:DescribeEndpoints'], resources: ['*'] }));
    p.key.grantEncryptDecrypt(completed);

    // ---- IoT custom authorizer: signed token -> per-principal, topic-scoped policy ----
    // The token is itself an HMAC-signed JWT verified inside the Lambda, so IoT-level signing is disabled.
    const authorizer = new iot.CfnAuthorizer(this, 'IotAuthorizer', {
      authorizerName: AUTHORIZER_NAME,
      authorizerFunctionArn: authorizerFn.functionArn,
      signingDisabled: true,
      status: 'ACTIVE',
      enableCachingForHttp: false,
    });
    authorizerFn.addPermission('InvokeByIot', {
      principal: new ServicePrincipal('iot.amazonaws.com'),
      sourceArn: authorizer.attrArn,
    });

    // ---- Cognito: staff (coach / club_admin groups) + authenticated athletes ----
    const pool = new cognito.UserPool(this, 'Users', {
      signInAliases: { email: true },
      selfSignUpEnabled: true,
      standardAttributes: { email: { required: true, mutable: true } },
      customAttributes: { club_id: new cognito.StringAttribute({ mutable: false, minLen: 3, maxLen: 40 }) },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: removal,
    });
    // Apple / Google federation: add UserPoolIdentityProviderApple/Google here once Apple/Google credentials exist.
    for (const g of ['coach', 'club_admin']) new cognito.CfnUserPoolGroup(this, `Group-${g}`, { userPoolId: pool.userPoolId, groupName: g });
    const client = pool.addClient('Mobile', {
      generateSecret: false,
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      // Users can never write `custom:club_id` (tenant binding) themselves: only admins via the console/API.
      writeAttributes: new cognito.ClientAttributes().withStandardAttributes({ email: true }),
      readAttributes: new cognito.ClientAttributes().withStandardAttributes({ email: true }).withCustomAttributes('club_id'),
    });

    // ---- HTTP API ----
    const api = new HttpApi(this, 'Http', {
      createDefaultStage: false,
      corsPreflight: {
        allowOrigins: [props.tvOrigin],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.PUT, CorsHttpMethod.OPTIONS],
        allowHeaders: ['authorization', 'content-type'],
        maxAge: Duration.hours(1),
      },
    });
    const stage = new HttpStage(this, 'Stage', { httpApi: api, stageName: '$default', autoDeploy: true, throttle: { rateLimit: 100, burstLimit: 200 } });
    // /join is public and PIN-guessable (10k space): tighter route-level throttle on top of the per-IP lockout.
    (stage.node.defaultChild as CfnStage).routeSettings = {
      'POST /join': { ThrottlingRateLimit: 10, ThrottlingBurstLimit: 20 },
    };

    const jwtAuth = new HttpUserPoolAuthorizer('CognitoAuth', pool, { userPoolClients: [client] });
    const route = (method: HttpMethod, routePath: string, f: IFunction, secured: boolean) =>
      api.addRoutes({
        path: routePath,
        methods: [method],
        integration: new HttpLambdaIntegration(`${f.node.id}Int`, f),
        authorizer: secured ? jwtAuth : undefined,
      });

    route(HttpMethod.POST, '/join', joinGuest, false);
    route(HttpMethod.POST, '/join/authenticated', joinAuth, true);
    route(HttpMethod.POST, '/classes', createClass, true);
    route(HttpMethod.POST, '/classes/{classId}/pin', rotatePin, true);
    route(HttpMethod.POST, '/classes/{classId}/end', endClass, true);
    route(HttpMethod.PUT, '/club/branding', putBranding, true);
    route(HttpMethod.PUT, '/classes/{classId}/roster/{athleteId}/name', overrideName, true);
    // TV bearer-token routes: verified inside the Lambda (token is class-scoped), so no Cognito authorizer.
    route(HttpMethod.GET, '/classes/{classId}', getClass, false);
    route(HttpMethod.GET, '/classes/{classId}/roster', getRoster, false);

    // ---- EventBridge: class completion -> results Lambda ----
    const dlq = new Queue(this, 'ClassCompletedDlq', { retentionPeriod: Duration.days(14), enforceSSL: true, removalPolicy: RemovalPolicy.DESTROY });
    new Rule(this, 'ClassCompletedRule', {
      eventBus: bus,
      eventPattern: { source: ['lmclub.classes'], detailType: ['ClassCompleted'] },
      targets: [new LambdaFunction(completed, { retryAttempts: 3, maxEventAge: Duration.hours(1), deadLetterQueue: dlq })],
    });

    new CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
    new CfnOutput(this, 'UserPoolId', { value: pool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: client.userPoolClientId });
    new CfnOutput(this, 'AuthorizerName', { value: AUTHORIZER_NAME });
  }
}
