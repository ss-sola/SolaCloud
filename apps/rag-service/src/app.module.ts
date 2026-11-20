import { EnableAutoRegister, EnableConfigCenter, EnableTypeOrm } from '@nest-cloud/sdk';
import { Module } from '@nestjs/common';
@EnableAutoRegister({ productionOnly: true })
@EnableTypeOrm()
@EnableConfigCenter()
@Module({
  imports: [],
  controllers: [],
  providers: [],
})
export class AppModule {}
