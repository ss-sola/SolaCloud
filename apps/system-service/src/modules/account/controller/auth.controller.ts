import { ProjectException, ResponseUtil, type AccountSessionRequest } from '@nest-cloud/sdk';
import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { OnlineUserService } from '../../monitor/service/online-user.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AUTH_CONTROLLER_ROUTE } from '../account.constants';
import { AccountLoginForm } from '../form/account-login.form';
import { AccountService } from '../service/account.service';
import { RuntimePermissionService } from '../service/runtime-permission.service';

@Controller(AUTH_CONTROLLER_ROUTE)
export class AuthController {
  constructor(
    private readonly accountService: AccountService,
    private readonly onlineUserService: OnlineUserService,
    private readonly runtimePermissionService: RuntimePermissionService,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: AccountLoginForm, @Req() req: AccountSessionRequest) {
    const account = await this.accountService.login(body.accountName, body.password, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    req.session.account = account;
    this.onlineUserService.upsert({
      sessionId: req.sessionID,
      accountId: account.accountId,
      accountName: account.accountName,
      displayName: account.displayName,
      avatarUrl: account.avatarUrl,
      sessionLoginAt: account.loginAt,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return ResponseUtil.success(account);
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: AccountSessionRequest) {
    const sessionId = req.sessionID;
    await this.accountService.logout(req.session?.account, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    this.onlineUserService.removeBySessionId(sessionId);
    await new Promise<void>((resolve, reject) => {
      if (!req.session?.destroy) {
        resolve();
        return;
      }
      req.session.destroy((error?: unknown) => {
        if (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        resolve();
      });
    });
    return ResponseUtil.success({ success: true });
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: AccountSessionRequest) {
    const account = await this.accountService.refreshSession(req.session?.account);
    if (req.session) {
      req.session.account = account;
    }
    return ResponseUtil.success(account);
  }

  @Get('current')
  async current(@Req() req: AccountSessionRequest) {
    const account = await this.accountService.validateSession(req.session?.account);
    return ResponseUtil.success({
      accountId: account.id,
      accountName: account.accountName,
      displayName: account.displayName,
      avatarUrl: account.avatarUrl ?? undefined,
    });
  }

  @UseGuards(SessionAuthGuard)
  @Post('refresh-permissions')
  @HttpCode(200)
  async refreshPermissions(@Req() req: AccountSessionRequest) {
    const accountId = req.session?.account?.accountId;
    if (!accountId) {
      throw new ProjectException('Session not found');
    }

    const runtime = await this.runtimePermissionService.getRuntimeByAccountId(accountId);

    if (req.session?.account) {
      req.session.account.permissionCodes = runtime.permissionCodes;
    }

    return ResponseUtil.success({
      permissionCodes: runtime.permissionCodes,
      updatedAt: new Date().toISOString(),
    });
  }
}
