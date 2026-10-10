import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // 微信「发货推送」发的是 XML，默认 bodyParser 只认 JSON，不配置就收不到（body 为空字符串）。
  // 只对 xml 类型生效，不影响其它接口。
  const bp = require('body-parser');
  app.use(bp.text({ type: ['text/xml', 'application/xml'] }));
  app.enableCors(); // 小程序调试方便；生产可限定域名
  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`📚 小说后端已启动: http://localhost:${port}`);
}
bootstrap();
