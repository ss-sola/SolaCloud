import { ResponseUtil } from '@nest-cloud/sdk';
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { GatewayUpstreamService } from '../proxy/gateway-upstream.service';

@Controller('health')
export class GatewayHealthController {
  constructor(private readonly upstreams: GatewayUpstreamService) {}

  @Get('live')
  live() {
    return ResponseUtil.success({ status: 'live' });
  }

  @Get('ready')
  ready() {
    if (!this.upstreams.isReady()) throw new ServiceUnavailableException('服务发现快照不可用');
    return ResponseUtil.success({ status: 'ready' });
  }
}
