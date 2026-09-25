import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodType } from "zod";
import { AppError } from "../utils/AppError.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- required by Express's ambient augmentation pattern
  namespace Express {
    interface Request {
      validated: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.validated = {
        body: schemas.body?.parse(req.body),
        query: schemas.query?.parse(req.query),
        params: schemas.params?.parse(req.params),
      };
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const message = err.issues
          // Refinements over the whole body (e.g. "at least one field") have no path, so no "field: " prefix.
          .map((issue) =>
            issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
          )
          .join("; ");
        next(new AppError(message, 400));
        return;
      }
      next(err);
    }
  };
}
