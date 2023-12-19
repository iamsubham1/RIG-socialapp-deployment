const mongoose = require('mongoose');

const loginSchema = new mongoose.Schema({
    name: String,
    userId: String,
    fancyId: String,
    password: String,
    profilePic: { type: String, default: "" },
    interests: { type: Array, default: [] },
    tokens: { type: Number, default: 5 },
    posts: { type: Array, default: [] },
    saved: { type: Array, default: [] },
    followers: { type: Array, default: [] },
    following: { type: Array, default: [] },
    socialId: { type: String, default: "" },
    live: { type: Boolean, default: false },
});

const Login = mongoose.model("Login", loginSchema);

module.exports = Login;
