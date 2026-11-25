import { CommonConfig, ConfigKeys, getConfig } from '@nest-cloud/sdk';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsString,
  ArrayNotEmpty,
  IsArray,
  IsUrl,
  Min,
  ValidateIf,
} from 'class-validator';
import { isIP } from 'node:net';
import { GATEWAY_DEFAULTS, GATEWAY_MODE, UPSTREAM } from './constants/gateway.constants';

const httpUrl = {
  protocols: ['http', 'https'],
  require_protocol: true,
  require_tld: false,
  disallow_auth: true,
  allow_query_components: false,
  allow_fragments: false,
};

export class GatewayConfig extends CommonConfig {
  override ServiceName = 'gateway-service';
  override Port: number = GATEWAY_DEFAULTS.port;

  @IsIn([''])
  override GlobalPrefix = '';

  @IsIn(Object.values(GATEWAY_MODE))
  GatewayUpstreamMode: (typeof GATEWAY_MODE)[keyof typeof GATEWAY_MODE] = GATEWAY_MODE.static;

  @ValidateIf((config: GatewayConfig) => config.GatewayUpstreamMode === GATEWAY_MODE.registry)
  @IsArray()
  @ArrayNotEmpty()
  @IsUrl(httpUrl, { each: true })
  RegistryUrl?: string[];

  @IsUrl(httpUrl)
  GatewaySystemUrl: string = GATEWAY_DEFAULTS.systemUrl;

  @IsUrl(httpUrl)
  GatewayMiddlewareUrl: string = GATEWAY_DEFAULTS.fileUrl;

  @IsUrl(httpUrl)
  GatewayRagUrl: string = GATEWAY_DEFAULTS.ragUrl;

  @IsUrl(httpUrl)
  GatewayCallGraphUrl: string = GATEWAY_DEFAULTS.callGraphUrl;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  GatewayRegistrySyncMs: number = GATEWAY_DEFAULTS.syncMs;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  GatewayRegistrySnapshotMs: number = GATEWAY_DEFAULTS.snapshotMs;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  GatewayRegistryLeaseMs: number = GATEWAY_DEFAULTS.leaseMs;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  GatewayConnectTimeoutMs: number = GATEWAY_DEFAULTS.connectMs;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  GatewayIdleTimeoutMs: number = GATEWAY_DEFAULTS.idleMs;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  GatewayStreamIdleTimeoutMs: number = GATEWAY_DEFAULTS.streamIdleMs;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  GatewayMaxBodyBytes: number = GATEWAY_DEFAULTS.bodyBytes;

  @IsString()
  GatewayTrustedProxyIps = '';

  @IsString()
  GatewayAllowedOrigins: string = GATEWAY_DEFAULTS.allowedOrigins;

  static useRegistry(): boolean {
    return (
      getConfig<GatewayConfig['GatewayUpstreamMode']>('GatewayUpstreamMode') ===
      GATEWAY_MODE.registry
    );
  }

  static registryOptions() {
    const discoveryOnly = this.useRegistry();
    return {
      discoveryOnly,
      registryUrl: discoveryOnly ? getConfig<string[]>(ConfigKeys.RegistryUrl) : undefined,
      controlPlaneToken: getConfig<string | string[]>(ConfigKeys.ControlPlaneToken, '', false),
      syncInterval: getConfig<number>('GatewayRegistrySyncMs'),
    };
  }

  static staticUpstreams() {
    return {
      [UPSTREAM.system]: this.origin(getConfig<string>('GatewaySystemUrl')),
      [UPSTREAM.file]: this.origin(getConfig<string>('GatewayMiddlewareUrl')),
      [UPSTREAM.callGraph]: this.origin(
        getConfig<string>('GatewayCallGraphUrl', GATEWAY_DEFAULTS.callGraphUrl),
      ),
      [UPSTREAM.rag]: this.origin(getConfig<string>('GatewayRagUrl')),
    };
  }

  static trustedProxyIps(): Set<string> {
    const addresses = getConfig<string>('GatewayTrustedProxyIps', '')
      .split(',')
      .map((address) => address.trim())
      .filter(Boolean);
    if (addresses.some((address) => !isIP(address))) {
      throw new Error('GatewayTrustedProxyIps must contain only IP addresses');
    }
    return new Set(addresses);
  }

  static allowedOrigins(): ReadonlySet<string> {
    const origins = getConfig<string>('GatewayAllowedOrigins', GATEWAY_DEFAULTS.allowedOrigins)
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    return new Set(origins.map((origin) => this.origin(origin, 'GatewayAllowedOrigins').origin));
  }

  private static origin(value: string, setting = 'Gateway upstream addresses'): URL {
    const address = new URL(value);
    if (
      address.pathname !== '/' ||
      address.search ||
      address.hash ||
      address.username ||
      address.password ||
      !['http:', 'https:'].includes(address.protocol)
    ) {
      throw new Error(`${setting} must contain HTTP(S) origins`);
    }
    return address;
  }
}
