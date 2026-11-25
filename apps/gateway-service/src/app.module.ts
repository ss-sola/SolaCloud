import { EnableConfigCenter, RegistryClientModule } from '@nest-cloud/sdk';
import { Module } from '@nestjs/common';
import { GatewayConfig } from './validate.config';

@EnableConfigCenter()
@Module({
  imports: [
    RegistryClientModule.registerAsync({ useFactory: () => GatewayConfig.registryOptions() }),
  ],
})
export class AppModule {}
