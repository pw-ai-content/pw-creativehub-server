"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachUser = attachUser;
exports.requireUser = requireUser;
exports.requireRole = requireRole;
function attachUser(req, _res, next) {
    const u = req.session?.user;
    if (u)
        req.user = u;
    next();
}
function requireUser(req, res, next) {
    if (req.user)
        return next();
    return res.status(401).json({ error: "auth required" });
}
// Single, flexible version: allow one or many roles
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user)
            return res.status(401).json({ error: "auth required" });
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: "forbidden" });
        }
        return next();
    };
}
//# sourceMappingURL=auth.js.map