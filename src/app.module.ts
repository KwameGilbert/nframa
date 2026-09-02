import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { allConfig } from './config/configuration.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { genReqId } from './common/request-id.js';
import { DatabaseModule } from './database/database.module.js';
import { QueuesModule } from './queues/queues.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    // load handles namespacing; env parsing/validation already happened once,
    // synchronously, when src/config/configuration.ts was first imported —
    // ignoreEnvFile here avoids a second, redundant .env read.
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: allConfig }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          genReqId,
          level: config.getOrThrow<string>('log.level'),
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          transport:
            config.getOrThrow<string>('app.env') === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.getOrThrow<number>('throttle.ttlMs'),
          limit: config.getOrThrow<number>('throttle.limit'),
        },
      ],
    }),
    DatabaseModule,
    QueuesModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    },
  ],
})
export class AppModule {}
