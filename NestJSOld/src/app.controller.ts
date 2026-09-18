import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';

// Version-neutral: sits at the bare root, outside the /v1 surface, so a
// request to the base URL with no path gets something other than a 404.
@Controller()
export class AppController {

  @Get()
  root(): { name: string; env: string; timestamp: string; version: string; status: 'ok';} {
    return {
      name: 'nframa-api',
      env: process.env.NODE_ENV ?? 'unknown',
      timestamp: new Date().toISOString(),
      version: '0.0.1',
      status: 'ok',
    };
  }
}
