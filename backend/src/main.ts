import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors(); // 小程序调试方便；生产可限定域名
  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`📚 小说后端已启动: http://localhost:${port}`);
}
bootstrap();
