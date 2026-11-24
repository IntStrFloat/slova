export type DownloadState = 'unknown' | 'pending' | 'downloading' | 'downloaded' | 'installing' | 'interrupted' | 'failed';
export type FailureResult = { result: 'unavailable' | 'retryable_error' | 'terminal_error' | 'unknown'; reason: string; errorCode?: number };
export type CheckResult = FailureResult | { result: 'none' | 'cancelled'; reason: string; errorCode?: number }
  | { result: 'available'; versionCode: string; installedVersionCode: string; state: DownloadState; infoToken: string };
export type FlowResult = FailureResult | { result: 'download_accepted' | 'cancelled' | 'flow_ended_unconfirmed'; reason: string; errorCode?: number };
export type DownloadEvent = { state: DownloadState; versionCode: string; errorCode?: number };
export interface UpdatesGateway {
  isSupported(): boolean;
  getNativeVersionCode(): string | null;
  checkAvailability(): Promise<CheckResult>;
  startFlexible(infoToken: string): Promise<FlowResult>;
  completeFlexible(versionCode: string): Promise<FlowResult>;
  discard(): void;
  subscribe(listener: (event: DownloadEvent) => void): () => void;
}
export function validVersion(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value)
    && (value.length < 19 || value <= '9223372036854775807');
}
export const DOWNLOAD_STATES: readonly DownloadState[] = ['unknown', 'pending', 'downloading', 'downloaded', 'installing', 'interrupted', 'failed'];
