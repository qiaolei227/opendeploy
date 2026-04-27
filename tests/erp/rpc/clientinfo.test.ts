import { describe, expect, it } from 'vitest';
import { buildClientInfo } from '../../../src/main/erp/k3cloud/rpc/clientinfo';

describe('rpc/clientinfo', () => {
  it('emits both PascalCase and camelCase fields with same values', () => {
    const ci = buildClientInfo();
    expect(ci.MacAddress).toBe(ci.macAddress);
    expect(ci.HostName).toBe(ci.hostName);
    expect(ci.IpAddress).toBe(ci.ipAddress);
  });

  it('has all keys observed in real BOS Designer captures', () => {
    const ci = buildClientInfo();
    const expected = [
      'vH',
      'vW',
      'MacAddress',
      'HostName',
      'IpAddress',
      'Version',
      'ScreenSize',
      'AvailableAreaSize',
      'macAddress',
      'hostName',
      'ipAddress',
      'OperationSystem',
    ];
    for (const k of expected) expect(ci).toHaveProperty(k);
  });

  it('has hardcoded version matching the K3 Cloud client we reverse-engineered against', () => {
    expect(buildClientInfo().Version).toBe('9.0.553.12');
  });

  it('uses uppercase MAC format like BOS Designer (28:A4:4A:..)', () => {
    const ci = buildClientInfo();
    expect(ci.MacAddress).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$|^00:00:00:00:00:00$/);
  });
});
