const crypto = require('crypto');

function timingSafeEqualToken(provided, expectedBuf) {
    if (typeof provided !== 'string' || !/^[a-f0-9]{64}$/i.test(provided)) {
        return false;
    }
    try {
        const a = Buffer.from(provided, 'hex');
        const b = expectedBuf;
        if (a.length !== b.length) {
            return false;
        }
        return crypto.timingSafeEqual(a, b);
    } catch {
        return false;
    }
}

module.exports = { timingSafeEqualToken };
