import type { ClassSession, RosterEntry } from '@lmclub/contracts/core';

/** Port used by the controller; the HTTP implementation below is the only place that knows the REST shape. */
export interface ClassApi {
  getSession(classId: string): Promise<ClassSession>;
  getRoster(classId: string): Promise<RosterEntry[]>;
}

export class HttpClassApi implements ClassApi {
  constructor(private readonly baseUrl: string, private readonly token: string) {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: { authorization: `Bearer ${this.token}` } });
    if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
    return (await res.json()) as T;
  }

  getSession(classId: string): Promise<ClassSession> {
    return this.get<ClassSession>(`/classes/${encodeURIComponent(classId)}`);
  }

  async getRoster(classId: string): Promise<RosterEntry[]> {
    return (await this.get<{ roster: RosterEntry[] }>(`/classes/${encodeURIComponent(classId)}/roster`)).roster;
  }
}
