import { EnableAutoRegister, EnableConfigCenter, EnableTypeOrm } from '@nest-cloud/sdk';
import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

@EnableAutoRegister({ productionOnly: true })
@EnableTypeOrm()
@EnableConfigCenter()
@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '../public'),
      serveRoot: '/public',
    }),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
