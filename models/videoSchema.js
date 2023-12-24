const mongoose = require('mongoose');

const videoSchema = new mongoose.Schema({
    email: { type: String, ref: 'userInfo' },
    creator: { type: String, ref: 'userInfo' },
    author: String,
    description: String,
    videoUrl: String,
    thumbnailUrl: String,
    likes: { type: Array, default: [] },
    comments: { type: Array, default: [] },
    saved: { type: Array, default: [] },
    createdAt: { type: Date, default: Date.now },
});

const Video = mongoose.model('Video', videoSchema);

module.exports = Video;
