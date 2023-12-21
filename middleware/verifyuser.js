
const jwt = require('jsonwebtoken');
const signature = process.env.signature;

const verifyUser = (req, res, next) => {
    try {
        const token = req.header('auth-token');
        console.log('Token:', token); // Add this line for debugging
        if (!token) return res.status(401).send({ msg: 'No token provided' });

        const data = jwt.verify(token, signature);
        req.user = data.user;
        next();
    } catch (error) {
        console.error(error);

        res.status(401).send({ error: `Error accessing the token: ${error.message}` });
    }
};
module.exports = verifyUser;