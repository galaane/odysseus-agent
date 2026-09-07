import dotenv from 'dotenv';
import { generateTotp, getRemainingTotpSeconds } from '../src/credentials/TotpGenerator.js';

dotenv.config();

const key = process.argv[2] || process.env.GOOGLE_TOTP_SECRET;

if (!key) {
  console.error('\n❌ Error: GOOGLE_TOTP_SECRET belum diset di .env dan tidak ada argumen key yang diberikan.\n');
  process.exit(1);
}

const code = generateTotp(key);
const remaining = getRemainingTotpSeconds();

console.log('\n=========================================');
console.log(`🔑 2FA / TOTP Authenticator Code: ${code}`);
console.log(`⏳ Berlaku selama: ${remaining} detik lagi`);
console.log('=========================================\n');
