import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { NovelModule } from './novel/novel.module';
import { AuthModule } from './auth/auth.module';
import { AppController } from './app.controller';

@Module({
  imports: [PrismaModule, NovelModule, AuthModule],
  controllers: [AppController],
})
export class AppModule {}
