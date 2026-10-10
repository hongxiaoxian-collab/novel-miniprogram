import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { NovelModule } from './novel/novel.module';
import { AuthModule } from './auth/auth.module';
import { PayModule } from './pay/pay.module';
import { AppController } from './app.controller';

@Module({
  imports: [PrismaModule, NovelModule, AuthModule, PayModule],
  controllers: [AppController],
})
export class AppModule {}
