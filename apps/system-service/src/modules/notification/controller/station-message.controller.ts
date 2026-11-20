import {
  ResponseUtil,
  BaseController,
  type AccountSessionRequest,
  ContextService,
} from '@nest-cloud/sdk';
import { Body, Controller, Get, HttpCode, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { PermissionGuard } from '../../account/auth/permission.guard';
import { RequirePermissions } from '../../account/auth/require-permissions.decorator';

import { SessionAuthGuard } from '../../account/auth/session-auth.guard';
import { SYSTEM_PERMISSION_CODES } from '../../account/auth/system-permission.constants';
import { STATION_MESSAGE_CONTROLLER_ROUTE } from '../notification.constants';
import { StationMessageIdParamForm } from '../form/station-message-id-param.form';
import { StationMessageQueryForm } from '../form/station-message-query.form';
import { StationMessageSendForm } from '../form/station-message-send.form';
import { NotificationService } from '../service/notification.service';
import { StationMessageItem } from '../entity/station-message.entity';
type StationMessageListResult = Awaited<ReturnType<NotificationService['listMessages']>>;

@UseGuards(SessionAuthGuard, PermissionGuard)
@Controller(STATION_MESSAGE_CONTROLLER_ROUTE)
export class StationMessageController extends BaseController<StationMessageItem, any> {
  constructor(private readonly notificationService: NotificationService) {
    super(notificationService);
  }

  @RequirePermissions(SYSTEM_PERMISSION_CODES.notificationManage)
  @Get('list')
  async listItems(
    @Query() query: StationMessageQueryForm,
  ): Promise<ResponseUtil<StationMessageListResult>> {
    return ResponseUtil.success(await this.notificationService.listMessages(query));
  }

  @Get('runtime/current')
  async listRuntimeCurrent(
    @Query() query: StationMessageQueryForm,
    @Req() req: AccountSessionRequest,
  ) {
    const accountId = ContextService.getCurrentAccount()?.accountId;
    return ResponseUtil.success(
      accountId ? await this.notificationService.listRuntimeMessages(accountId, query.isRead) : [],
    );
  }

  @Get('unread-count')
  async unreadCount(@Req() req: AccountSessionRequest) {
    const accountId = ContextService.getCurrentAccount()?.accountId;
    return ResponseUtil.success(
      accountId ? await this.notificationService.unreadCount(accountId) : 0,
    );
  }

  @RequirePermissions(SYSTEM_PERMISSION_CODES.notificationManage)
  @Post('send')
  @HttpCode(200)
  async send(@Body() body: StationMessageSendForm, @Req() req: AccountSessionRequest) {
    return ResponseUtil.success(
      await this.notificationService.sendMessages({
        ...body,
        senderAccountId: ContextService.getCurrentAccount()?.accountId,
      }),
    );
  }

  @Put('read')
  async markRead(@Query() query: StationMessageIdParamForm, @Req() req: AccountSessionRequest) {
    return ResponseUtil.success(
      await this.notificationService.markRead(
        query.id,
        ContextService.getCurrentAccount()?.accountId,
      ),
    );
  }

  @Put('read-all')
  async markAllRead(@Req() req: AccountSessionRequest) {
    const accountId = ContextService.getCurrentAccount()?.accountId;
    return ResponseUtil.success(
      accountId
        ? await this.notificationService.markAllRead(accountId)
        : { updatedCount: 0, items: [] },
    );
  }
}
