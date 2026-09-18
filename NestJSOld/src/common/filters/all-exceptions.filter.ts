import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

// Every non-2xx response is shaped { error: { code, message, details? } },
// regardless of whether it came from an HttpException thrown deliberately or
// an unexpected error bubbling up from anywhere in the app. `code` is a
// stable, machine-readable string API consumers can branch on; `message` is
// safe to show a human. Unknown errors never leak their real message/stack to
// the client — only to the server log.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = (request as Request & { id?: string }).id;

    const { status, body } = this.resolve(exception);
    const line = `${request.method} ${request.url} -> ${status} ${body.code}`;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(line, exception instanceof Error ? exception.stack : String(exception));
    } else if (status >= HttpStatus.BAD_REQUEST) {
      this.logger.warn(line);
    }

    response.status(status).json({
      error: body,
      ...(requestId ? { requestId } : {}),
    });
  }

  private resolve(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return { status, body: this.fromHttpException(status, exception) };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { code: 'INTERNAL', message: 'An unexpected error occurred.' },
    };
  }

  private fromHttpException(status: number, exception: HttpException): ErrorBody {
    const payload = exception.getResponse();

    // class-validator's ValidationPipe throws a BadRequestException shaped
    // { statusCode, message: string[], error: 'Bad Request' } — surface it as
    // one VALIDATION_ERROR with the individual field messages in `details`,
    // rather than one long concatenated sentence.
    if (
      status === HttpStatus.BAD_REQUEST &&
      typeof payload === 'object' &&
      payload !== null &&
      Array.isArray((payload as { message?: unknown }).message)
    ) {
      return {
        code: 'VALIDATION_ERROR',
        message: 'One or more fields failed validation.',
        details: { fields: (payload as { message: string[] }).message },
      };
    }

    const rawMessage =
      typeof payload === 'string'
        ? payload
        : ((payload as { message?: unknown })?.message ?? exception.message);

    return {
      code: this.codeForStatus(status),
      message: Array.isArray(rawMessage) ? rawMessage.join(' ') : String(rawMessage),
    };
  }

  private codeForStatus(status: number): string {
    return (HttpStatus as unknown as Record<number, string>)[status] ?? 'HTTP_ERROR';
  }
}
