//Purpose: Allows only users with role === "admin" to access dashboard APIs.

// backend/middlewares/adminOnly.admin.js
module.exports = function adminOnlyAdmin(req, res, next) {
  const role = String(req.user?.role || "").toLowerCase();
  if (role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
};