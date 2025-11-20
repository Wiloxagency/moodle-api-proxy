import { Request, Response, NextFunction } from 'express';
import { config } from '../config/environment';

export interface AppError extends Error {
  statusCode?: number;
  status?: string;
  isOperational?: boolean;
}

export const createError = (message: string, statusCode: number = 500): AppError => {
  const error: AppError = new Error(message);
  error.statusCode = statusCode;
  error.status = statusCode >= 400 && statusCode < 500 ? 'fail' : 'error';
  error.isOperational = true;
  return error;
};

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const { statusCode = 500, message, stack } = err;

  // Log error
  console.error(`Error ${statusCode}: ${message}`);
  if (config.nodeEnv === 'development') {
    console.error('Stack trace:', stack);
  }

  // Send error response
  res.status(statusCode).json({
    success: false,
    error: {
      message: statusCode === 500 ? 'Internal server error' : message,
      ...(config.nodeEnv === 'development' && { stack })
    }
  });
};

export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
  const error = createError(`Route ${req.originalUrl} not found`, 404);
  next(error);
};

export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
