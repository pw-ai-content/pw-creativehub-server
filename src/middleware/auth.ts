import type { Request, Response, NextFunction } from "express";

export type Role = "admin" | "sme" | "user";
export type SessionUser = { _id: string; email: string; name?: string; role: Role };

declare module "express-serve-static-core" {
  interface Request {
    user?: SessionUser;
    session?: any;
  }
}

export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const u = req.session?.user as SessionUser | undefined;
  if (u) req.user = u;
  next();
}


export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (req.user) return next();
  return res.status(401).json({ error: "auth required" });
}

// Single, flexible version: allow one or many roles
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "auth required" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "forbidden" });
    }
    return next();
  };
}
