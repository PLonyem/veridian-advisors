const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async (mailOptions) => ({ messageId: 'fake-' + Date.now(), envelope: {}, mailOptions }),
});

require('./src/server.js');
