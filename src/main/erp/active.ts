import { K3CloudConnector } from './k3cloud/connector';
import type { ErpConnectionState, Project } from '@shared/erp-types';

/**
 * Singleton holder for the currently-active connector. Only one project is
 * "live" at a time — switching projects tears down the outgoing pool so we
 * never accidentally run a query against the wrong account set.
 */

let connector: K3CloudConnector | null = null;
let state: ErpConnectionState = { projectId: null, status: 'idle' };
let listeners: Array<(s: ErpConnectionState) => void> = [];

function updateState(patch: Partial<ErpConnectionState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l(state);
}

export function subscribe(l: (s: ErpConnectionState) => void): () => void {
  listeners.push(l);
  l(state);
  return () => {
    listeners = listeners.filter((x) => x !== l);
  };
}

export function getActiveConnector(): K3CloudConnector | null {
  return connector;
}

export function getConnectionState(): ErpConnectionState {
  return state;
}

/**
 * Swap the active connector. Passing `null` tears the current one down.
 *
 * Error semantics: if connect() throws, we leave `connector` null and
 * `state.status = 'error'` — the caller (IPC layer) should surface the
 * error to the UI but not throw, so the user's UI stays responsive.
 */
export async function setActiveProject(project: Project | null): Promise<void> {
  // Tear down the outgoing connector regardless of outcome.
  if (connector) {
    await connector.disconnect().catch(() => undefined);
    connector = null;
  }

  if (!project) {
    updateState({ projectId: null, status: 'idle', error: undefined });
    return;
  }

  updateState({ projectId: project.id, status: 'connecting', error: undefined });
  const next = new K3CloudConnector(project.connection);
  try {
    await next.connect();
    connector = next;
    updateState({
      status: 'connected',
      lastTestedAt: new Date().toISOString()
    });
  } catch (err) {
    updateState({
      status: 'error',
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

/** Test-only helper: wipe module state between tests. */
export function _reset(): void {
  connector = null;
  state = { projectId: null, status: 'idle' };
  listeners = [];
}
