import { getConfig, RegistryClientService, ServiceAddressUtil } from '@nest-cloud/sdk';
import { Injectable } from '@nestjs/common';
import { isIP } from 'node:net';
import { UPSTREAM, type UpstreamName } from '../../constants/gateway.constants';
import { GatewayConfig } from '../../validate.config';

export type GatewayTarget = { address: URL; instanceId?: string };

@Injectable()
export class GatewayUpstreamService {
  private readonly discovery = GatewayConfig.useRegistry();
  private readonly staticUpstreams = GatewayConfig.staticUpstreams();
  private readonly snapshotMs = getConfig<number>('GatewayRegistrySnapshotMs');
  private readonly leaseMs = getConfig<number>('GatewayRegistryLeaseMs');
  private readonly offsets = new Map<UpstreamName, number>();

  constructor(private readonly registry: RegistryClientService) {}

  isReady(now = Date.now()): boolean {
    if (!this.discovery) return true;
    const lastSyncAt = this.registry.getLastSyncAt();
    return lastSyncAt !== undefined && now - lastSyncAt <= this.snapshotMs;
  }

  select(service: UpstreamName, now = Date.now()): GatewayTarget | undefined {
    if (!this.discovery) return { address: this.staticUpstreams[service] };
    if (!this.isReady(now)) return undefined;

    const targets = this.registry.getInstances(service).flatMap((instance): GatewayTarget[] => {
      if (
        !instance ||
        !Number.isFinite(instance.lastHeartbeat) ||
        now - instance.lastHeartbeat > this.leaseMs ||
        !Number.isInteger(instance.port) ||
        instance.port < 1 ||
        instance.port > 65535 ||
        typeof instance.host !== 'string' ||
        !(isIP(instance.host) || /^[a-z0-9][a-z0-9.-]*$/i.test(instance.host))
      ) {
        return [];
      }
      try {
        const address = new URL(ServiceAddressUtil.httpOrigin(instance.host, instance.port));
        return [{ address, instanceId: instance.id }];
      } catch {
        return [];
      }
    });
    if (!targets.length) return undefined;
    // File chunks and merged files are local to the single configured storage instance.
    if (service === UPSTREAM.file && targets.length !== 1) return undefined;
    const index = (this.offsets.get(service) ?? 0) % targets.length;
    this.offsets.set(service, index + 1);
    return targets[index];
  }
}
