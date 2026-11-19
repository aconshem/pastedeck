const { decide } = require('./_lib/device-decision');
exports.handler = (event) => decide(event, 'approve');
