import nodemailer from 'nodemailer';

const EMAIL_USER = process.env.EMAIL_USER; // your email
const EMAIL_PASS = process.env.EMAIL_PASS; // your email app password
const FRONTEND_URL = process.env.FRONTEND_URL;

const createTransporter = () => {
  return nodemailer.createTransport({
    service: 'gmail', // or your preferred email service
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS
    }
  });
};

// Function to send verification email
export const sendVerificationEmail = async (email, verificationToken, name) => {
  const transporter = createTransporter();
  
  const verificationUrl = `${FRONTEND_URL}/verify-email?token=${verificationToken}`;
  
  const mailOptions = {
    from: EMAIL_USER,
    to: email,
    subject: 'Verify Your Email - Boardly Platform',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          .email-container { max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; }
          .header h1 { color: white; margin: 0; font-size: 28px; }
          .content { padding: 40px 30px; background: #ffffff; }
          .button { 
            display: inline-block; 
            padding: 15px 30px; 
            background: #667eea; 
            color: white; 
            text-decoration: none; 
            border-radius: 8px; 
            margin: 20px 0; 
            font-weight: bold;
          }
          .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #6c757d; font-size: 14px; }
          .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 8px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="email-container">
          <div class="header">
            <h1>Welcome to Boardly 🎓</h1>
          </div>
          <div class="content">
            <h2>Hi ${name},</h2>
            <p>Thank you for joining Boardly! To complete your registration and start your learning journey, please verify your email address.</p>
            
            <div style="text-align: center;">
              <a href="${verificationUrl}" class="button">Verify Email Address</a>
            </div>
            
            <div class="warning">
              <strong>⚠️ Important:</strong> This verification link will expire in 24 hours. If you didn't create this account, please ignore this email.
            </div>
            
            <p>If the button doesn't work, copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #667eea;">${verificationUrl}</p>
            
            <p>Once verified, you'll be able to:</p>
            <ul>
              <li>📚 Enjoy a seamless interactive class</li>
              <li>👥 Join study sessions</li>
              <li>💬 Connect with tutors and students</li>
              <li>💸 Turn your teaching skills into money</li>
            </ul>
            
            <p>Need help? Reply to this email and our support team will assist you.</p>
            
            <p>Best regards,<br>The Boardly Team</p>
          </div>
          <div class="footer">
            <p>&copy; 2025 Boardly. All rights reserved.</p>
            <p>This email was sent to ${email}. If you didn't sign up, please ignore this message.</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('Verification email sent to:', email);
    return true;
  } catch (error) {
    console.error('Error sending verification email:', error);
    return false;
  }
};
