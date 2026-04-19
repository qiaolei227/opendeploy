import type { IpcApi } from '@shared/types';

declare global {
  interface Window {
    opendeploy: IpcApi;
  }
}

export {};
