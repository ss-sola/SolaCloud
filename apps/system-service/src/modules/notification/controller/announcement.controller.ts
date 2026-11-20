import {
  ResponseUtil,
  BaseController,
  type AccountSessionRequest,
  ContextService,
} from '@nest-cloud/sdk';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PermissionGuard } from '../../account/auth/permission.guard';
import { RequirePermissions } from '../../account/auth/require-permissions.decorator';
import { SessionAuthGuard } from '../../account/auth/session-auth.guard';
import { SYSTEM_PERMISSION_CODES } from '../../account/auth/system-permission.constants';
import { ANNOUNCEMENT_CONTROLLER_ROUTE } from '../notification.constants';
import { AnnouncementIdParamForm } from '../form/announcement-id-param.form';
import { AnnouncementQueryForm } from '../form/announcement-query.form';
import { AnnouncementSaveForm } from '../form/announcement-save.form';
import { NotificationService } from '../service/notification.service';
import { AnnouncementItem } from '../entity/announcement.entity';
type AnnouncementListResult = Awaited<ReturnType<NotificationService['listAnnouncements']>>;
type AnnouncementCreateResult = Awaited<ReturnType<NotificationService['saveAnnouncement']>>;

@UseGuards(SessionAuthGuard, PermissionGuard)
@Controller(ANNOUNCEMENT_CONTROLLER_ROUTE)
export class AnnouncementController extends BaseController<AnnouncementItem, NotificationService> {
  constructor(private readonly notificationService: NotificationService) {
    super(notificationService);
  }

  @RequirePermissions(SYSTEM_PERMISSION_CODES.notificationManage)
  @Get('overview')
  async getOverview() {
    return ResponseUtil.success(await this.notificationService.getOverview());
  }

  @RequirePermissions(SYSTEM_PERMISSION_CODES.notificationManage)
  @Get('list')
  async listItems(
    @Query() query: AnnouncementQueryForm,
  ): Promise<ResponseUtil<AnnouncementListResult>> {
    return ResponseUtil.success(await this.notificationService.listAnnouncements(query));
  }

  @RequirePermissions(SYSTEM_PERMISSION_CODES.notificationManage)
  @Get('item')
  async getItem(@Query() query: AnnouncementIdParamForm) {
    return ResponseUtil.success(await this.notificationService.getAnnouncement(query.id));
  }

  @Get('runtime')
  async listRuntime() {
    return ResponseUtil.success(await this.notificationService.listRuntimeAnnouncements());
  }

  @RequirePermissions(SYSTEM_PERMISSION_CODES.notificationManage)
  @HttpCode(200)
  @Post('item')
  async createItem(
    @Body() body: AnnouncementSaveForm,
    @Req() req: AccountSessionRequest,
  ): Promise<ResponseUtil<AnnouncementCreateResult>> {
    return ResponseUtil.success(
      await this.notificationService.saveAnnouncement({
        ...body,
        publisherAccountId: ContextService.getCurrentAccount()?.accountId,
      }),
    );
  }

  @RequirePermissions(SYSTEM_PERMISSION_CODES.notificationManage)
  @Put('item')
  async updateItem(
    @Query() query: AnnouncementIdParamForm,
    @Body() body: AnnouncementSaveForm,
    @Req() req: AccountSessionRequest,
  ) {
    return ResponseUtil.success(
      await this.notificationService.saveAnnouncement(
        {
          ...body,
          publisherAccountId: ContextService.getCurrentAccount()?.accountId,
        },
        query.id,
      ),
    );
  }

  @RequirePermissions(SYSTEM_PERMISSION_CODES.notificationManage)
  @Delete('item')
  async removeItem(@Query() query: AnnouncementIdParamForm) {
    return ResponseUtil.success(await this.notificationService.removeAnnouncement(query.id));
  }
}
