import { ENV } from '@/core/config/env';

export interface Row {
  userId: string;
  nickname: string;
  tag: string;
  score: number;
  division: string;
  rank: number;
}
export interface Snapshot {
  scope: string;
  week: string;
  top: Row[];
  me: Row | null;
  neighbors: Row[];
  total: number;
}
export interface Profile {
  userId: string;
  nickname: string;
  tag: string;
  levels: number;
  score: number;
  division: string;
}

export interface EventBoard {
  event: { id: string; title: string; metric: string; week: string };
  board: Row[];
  me: Row | null;
}
export interface TeamMember {
  nickname: string;
  score: number;
}
export interface Team {
  id: string;
  name: string;
  leaderId: string;
  memberCount: number;
  totalScore: number;
  members: TeamMember[];
}

export interface BackendClient {
  bootstrap(nickname: string): Promise<{ profile: Profile; authToken: string }>;
  rename(token: string, nickname: string): Promise<Profile>;
  submitProgress(token: string, levels: number): Promise<Snapshot>;
  leaderboard(token: string, scope: 'global' | 'weekly'): Promise<Snapshot>;
  pullSave(token: string): Promise<unknown>;
  pushSave(token: string, version: number, save: unknown): Promise<unknown>;
  eventsCurrent(token: string): Promise<EventBoard>;
  teamsList(token: string): Promise<{ teams: Team[] }>;
  teamMine(token: string): Promise<{ team: Team | null }>;
  teamCreate(token: string, name: string): Promise<{ team: Team }>;
  teamJoin(token: string, id: string): Promise<{ team: Team }>;
  teamLeave(token: string): Promise<{ ok: boolean }>;
}

function makeHttp(base: string): BackendClient {
  async function req(path: string, method: string, token?: string, body?: unknown) {
    const res = await fetch(base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return res.json();
  }
  return {
    bootstrap: (nickname) => req('/api/profile/bootstrap', 'POST', undefined, { nickname }),
    rename: (token, nickname) => req('/api/profile/rename', 'POST', token, { nickname }).then((r) => r.profile),
    submitProgress: (token, levels) => req('/api/progress', 'POST', token, { levels }),
    leaderboard: (token, scope) => req(`/api/leaderboard?scope=${scope}`, 'GET', token),
    pullSave: (token) => req('/api/save', 'GET', token).then((r) => r.save),
    pushSave: (token, version, save) => req('/api/save', 'POST', token, { version, save }).then((r) => r.save),
    eventsCurrent: (token) => req('/api/events/current', 'GET', token),
    teamsList: (token) => req('/api/teams', 'GET', token),
    teamMine: (token) => req('/api/teams/mine', 'GET', token),
    teamCreate: (token, name) => req('/api/teams', 'POST', token, { name }),
    teamJoin: (token, id) => req(`/api/teams/${id}/join`, 'POST', token),
    teamLeave: (token) => req('/api/teams/me/leave', 'POST', token),
  };
}

const NoopBackend: BackendClient = {
  async bootstrap() {
    throw new Error('offline');
  },
  async rename() {
    throw new Error('offline');
  },
  async submitProgress() {
    throw new Error('offline');
  },
  async leaderboard() {
    throw new Error('offline');
  },
  async pullSave() {
    return null;
  },
  async pushSave() {
    return null;
  },
  async eventsCurrent() {
    throw new Error('offline');
  },
  async teamsList() {
    throw new Error('offline');
  },
  async teamMine() {
    throw new Error('offline');
  },
  async teamCreate() {
    throw new Error('offline');
  },
  async teamJoin() {
    throw new Error('offline');
  },
  async teamLeave() {
    throw new Error('offline');
  },
};

export function getBackend(): BackendClient {
  return ENV.apiUrl ? makeHttp(ENV.apiUrl) : NoopBackend;
}
