import { config } from './config';
import {
  DynamoClassRepository, DynamoClubRepository, DynamoHistoryRepository, DynamoPinRepository, DynamoRosterRepository,
} from './dynamo';
import { EventBridgePublisher } from './events';
import { IotControlPublisher } from './iot';
import { TimestreamTelemetryRepository } from './timestream';

/** Composition root for Lambdas: constructed lazily, once per execution environment. */
let memo: ReturnType<typeof build> | undefined;

function build() {
  return {
    pins: new DynamoPinRepository(),
    classes: new DynamoClassRepository(),
    clubs: new DynamoClubRepository(),
    roster: new DynamoRosterRepository(),
    history: new DynamoHistoryRepository(),
    control: new IotControlPublisher(),
    events: new EventBridgePublisher(),
    telemetry: new TimestreamTelemetryRepository(),
    realtime: { iot_endpoint: config.iotEndpoint, authorizer: config.authorizerName },
  };
}

export const container = () => (memo ??= build());
export const nowSec = (): number => Math.floor(Date.now() / 1000);
