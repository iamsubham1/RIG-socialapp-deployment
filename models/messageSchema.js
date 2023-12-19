const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    from: String,
    to: String,
    message: String,
    seen: { type: Boolean, default: false },
});

const Message = mongoose.model("Message", messageSchema);

module.exports = Message;
