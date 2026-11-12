import mqtt, { type MqttClient } from 'mqtt';
import { classWildcard } from '@lmclub/contracts/core';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';

export interface RealtimeConfig {
  iotEndpoint: string;
  authorizerName: string;
  clubId: string;
  classId: string;
  /** Called on every (re)connect so a renewed token is picked up without recreating the client. */
  getToken: () => string;
}

/** Port: lets the controller be tested without a broker, and the transport be swapped (e.g. MQTT.js -> AWS CRT). */
export interface RealtimeTransport {
  start(handlers: {
    onMessage: (topic: string, payload: string) => void;
    onStatus: (s: ConnectionStatus) => void;
  }): void;
  stop(): void;
}

export class MqttTransport implements RealtimeTransport {
  private client: MqttClient | null = null;

  constructor(private readonly cfg: RealtimeConfig) {}

  start(h: { onMessage: (topic: string, payload: string) => void; onStatus: (s: ConnectionStatus) => void }): void {
    const { cfg } = this;
    const url = `wss://${cfg.iotEndpoint}/mqtt`;
    h.onStatus('connecting');

    this.client = mqtt.connect(url, {
      protocolVersion: 4,
      // Must match the IoT authorizer policy: client/tv-{classId}-*
      clientId: `tv-${cfg.classId}-${crypto.randomUUID().slice(0, 8)}`,
      clean: true,
      keepalive: 30,
      connectTimeout: 10_000,
      reconnectPeriod: 2_000,
      // Browsers cannot set WS headers, so the custom-authorizer name + token travel in the query string.
      transformWsUrl: (u) => {
        const q = new URLSearchParams({ 'x-amz-customauthorizer-name': cfg.authorizerName, token: cfg.getToken() });
        return `${u}?${q.toString()}`;
      },
    });

    this.client.on('connect', () => {
      // QoS 1 so the retained class.results (QoS 1) is delivered on (re)subscribe; telemetry stays QoS 0.
      this.client?.subscribe(classWildcard(cfg.clubId, cfg.classId), { qos: 1 }, (err) => {
        if (!err) h.onStatus('connected');
      });
    });
    this.client.on('reconnect', () => h.onStatus('reconnecting'));
    this.client.on('close', () => h.onStatus(this.client?.reconnecting ? 'reconnecting' : 'closed'));
    this.client.on('message', (topic, payload) => h.onMessage(topic, payload.toString('utf8')));
    this.client.on('error', () => undefined); // surfaced through 'close'/'reconnect'; never log tokens
  }

  stop(): void {
    this.client?.end(true);
    this.client = null;
  }
}
