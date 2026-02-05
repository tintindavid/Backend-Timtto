declare namespace Jwt {
  export interface Payload {
    userId: string;
    role?: string;
    iat?: number;
    exp?: number;
  }
}

declare namespace Express {
  export interface Request {
    user?: Jwt.Payload;
  }
}
