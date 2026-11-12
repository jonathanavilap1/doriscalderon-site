import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';
import { controlTopic, type ControlMessage } from '@lmclub/contracts';
import { config } from './config';
import type { ControlPublisher } from '../domain/ports';

export class IotControlPublisher implements ControlPublisher {
  private readonly client = new IoTDataPlaneClient({ endpoint: `https://${config.iotEndpoint}` });

  async publish(clubId: string, classId: string, message: ControlMessage, opts: { retain?: boolean } = {}): Promise<void> {
    await this.client.send(
      new PublishCommand({
        topic: controlTopic(clubId, classId),
        qos: 1,
        retain: opts.retain ?? false,
        contentType: 'application/json',
        payload: Buffer.from(JSON.stringify(message)),
      }),
    );
  }
}
