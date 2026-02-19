const jwt = require("jsonwebtoken");

module.exports = function authenticate(req, res, next) {

    const authHeader = req.headers.authorization;

    // Check header existence
    if (!authHeader) {
        return res.status(401).json({
            message: "Authorization header missing"
        });
    }

    // Extract token
    const token = authHeader.startsWith("Bearer ")
        ? authHeader.split(" ")[1]
        : null;

    if (!token) {
        return res.status(401).json({
            message: "No Token"
        });
    }

    try {

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        // Explicitly assign required identity fields
        req.user = {
            _id: decoded._id,
            email: decoded.email,
            role: decoded.role
        };

        next();

    }
    catch (error) {

        return res.status(401).json({
            message: "Invalid Token"
        });

    }

};
