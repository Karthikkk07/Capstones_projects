export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  static badRequest(msg = 'Bad request', details?: unknown) {
    return new HttpError(400, msg, details);
  }
  static unauthorized(msg = 'Authentication required') {
    return new HttpError(401, msg);
  }
  static forbidden(msg = 'Forbidden') {
    return new HttpError(403, msg);
  }
  static notFound(msg = 'Not found') {
    return new HttpError(404, msg);
  }
  static conflict(msg = 'Conflict') {
    return new HttpError(409, msg);
  }
  static unavailable(msg = 'Service unavailable') {
    return new HttpError(503, msg);
  }
}
