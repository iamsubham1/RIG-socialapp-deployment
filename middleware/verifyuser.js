
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: '.env' });

const verifyUser = (req, res, next) => {
    try {
        const token = req.header('token');
        console.log('Token:', token); // Add this line for debugging

        if (!token) {
            // No token provided
            return res.status(401).send({ msg: 'No token provided' });
        }

        // Verify the token
        const decoded = jwt.verify(token, process.env.JWT_SIGNATURE);

        // Attach user email to req.user
        console.log('Decoded Token:', decoded);
        req.user = decoded;
        // Continue to the next middleware or route handler
        next();
    } catch (error) {
        console.error(error);

        // Token verification failed
        res.status(401).send({ error: `Error accessing the token: ${error.message}` });
    }
};
module.exports = verifyUser