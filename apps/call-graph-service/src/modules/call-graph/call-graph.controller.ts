import {
  ContextService,
  PermissionGuard,
  RequirePermissions,
  ResponseUtil,
  SessionAuthGuard,
} from '@nest-cloud/sdk';
import { Body, Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { EventQuery, ProjectForm, RouteForm, SessionForm, StartForm } from './forms';
import { ProbeProcessService } from './probe-process.service';
import { ProjectAnalysisService } from './project-analysis.service';
import { ProbeDictionaryClient } from './probe-dictionary.client';

@Controller('call-graph')
@UseGuards(SessionAuthGuard, PermissionGuard)
@RequirePermissions('system:call-graph:debug')
export class CallGraphController {
  constructor(
    private readonly analysis: ProjectAnalysisService,
    private readonly probes: ProbeProcessService,
    private readonly dictionary: ProbeDictionaryClient,
  ) {}

  @Post('scan')
  async scan(@Body() form: ProjectForm) {
    return ResponseUtil.success(await this.analysis.scan(form.project));
  }

  @Post('graph')
  async graph(@Body() form: RouteForm) {
    return ResponseUtil.success(await this.analysis.graph(form.project, form.routeId));
  }

  @Post('start')
  async start(@Body() form: StartForm) {
    const owner = ContextService.getCurrentAccount().accountId;
    const target = await this.analysis.target(form.project, form.routeId);
    const limits = await this.dictionary.readLimits();
    return ResponseUtil.success(this.probes.start(owner, target, limits));
  }

  @Post('stop')
  async stop(@Body() form: SessionForm) {
    return ResponseUtil.success(
      await this.probes.stop(ContextService.getCurrentAccount().accountId, form.sessionId),
    );
  }

  @Get('events')
  events(@Query() query: EventQuery, @Res() response: Response) {
    this.probes
      .owned(ContextService.getCurrentAccount().accountId, query.sessionId)
      .stream(query.after, response);
  }
}
