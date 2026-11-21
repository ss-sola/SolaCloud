import { AuthDenied, type AccountSessionRequest } from '@nest-cloud/sdk';
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { SYSTEM_PERMISSION_CODES } from '../account/auth/system-permission.constants';
import { AccountService } from '../account/service/account.service';
import { RuntimePermissionService } from '../account/service/runtime-permission.service';

@Injectable()
export class TraceLogAccessGuard implements CanActivate {
  constructor(
    private readonly accounts: AccountService,
    private readonly permissions: RuntimePermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { session } = context.switchToHttp().getRequest<AccountSessionRequest>();
    if (!session?.account) throw new AuthDenied('请先登录');

    const account = await this.accounts.validateSession(session.account);
    if (
      !(await this.permissions.hasCurrentPermission(
        account.id,
        SYSTEM_PERMISSION_CODES.traceLogQuery,
      ))
    ) {
      throw new AuthDenied('缺少集中日志查询权限');
    }
    return true;
  }
}
