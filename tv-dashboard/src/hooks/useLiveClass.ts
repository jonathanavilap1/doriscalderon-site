import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { LiveClassController, type LiveClassView } from '../domain/liveClassController';
import { HttpClassApi, type ClassApi } from '../infra/api';
import { MqttTransport } from '../infra/realtime';

export interface UseLiveClassOptions {
  apiBaseUrl: string;
  classId: string;
  /** Class-scoped display token minted by POST /classes. */
  token: string;
  /** Test seam. */
  api?: ClassApi;
}

/**
 * Subscribes the TV to `{clubID}/{classID}/#` over MQTT/WebSocket and exposes the live view.
 * React re-renders at most once per animation frame regardless of MQTT message rate.
 */
export function useLiveClass(opts: UseLiveClassOptions): LiveClassView {
  const controller = useMemo(
    () =>
      new LiveClassController({
        classId: opts.classId,
        api: opts.api ?? new HttpClassApi(opts.apiBaseUrl, opts.token),
        createTransport: (s) =>
          new MqttTransport({
            iotEndpoint: s.realtime.iot_endpoint,
            authorizerName: s.realtime.authorizer,
            clubId: s.club_id,
            classId: s.class_id,
            getToken: () => opts.token,
          }),
        schedule: (cb) => {
          const id = requestAnimationFrame(() => cb());
          return () => cancelAnimationFrame(id);
        },
        now: () => Date.now(),
      }),
    [opts.apiBaseUrl, opts.classId, opts.token, opts.api],
  );

  useEffect(() => {
    void controller.start();
    return () => controller.dispose();
  }, [controller]);

  return useSyncExternalStore(controller.subscribe, controller.getView, controller.getView);
}
