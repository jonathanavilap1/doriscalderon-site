import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { config } from './config';
import type { ClassCompletedDetail, EventPublisher } from '../domain/ports';

export const EVENT_SOURCE = 'lmclub.classes';
export const EVENT_CLASS_COMPLETED = 'ClassCompleted';

export class EventBridgePublisher implements EventPublisher {
  private readonly client = new EventBridgeClient({});

  async classCompleted(detail: ClassCompletedDetail): Promise<void> {
    const r = await this.client.send(
      new PutEventsCommand({
        Entries: [{ EventBusName: config.eventBusName, Source: EVENT_SOURCE, DetailType: EVENT_CLASS_COMPLETED, Detail: JSON.stringify(detail) }],
      }),
    );
    if (r.FailedEntryCount) throw new Error('EventBridge rejected ClassCompleted');
  }
}
