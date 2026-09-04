/**
 * Development seed script — creates two demo users + a friendship.
 * Run:  npm run seed
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import { hashPassword } from '../utils/password.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/billchat');
  console.log('Connected. Seeding...');

  const pw = await hashPassword('password123');

  const [alice, bob] = await Promise.all([
    User.findOneAndUpdate(
      { customId: 'alice' },
      {
        name: 'Alice',
        email: 'alice@example.com',
        customId: 'alice',
        password: pw,
        status: 'Hello from Alice',
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ),
    User.findOneAndUpdate(
      { customId: 'bob' },
      {
        name: 'Bob',
        email: 'bob@example.com',
        customId: 'bob',
        password: pw,
        status: 'Hello from Bob',
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ),
  ]);

  // Make them friends
  await Promise.all([
    User.updateOne({ _id: alice._id }, { $addToSet: { friends: bob._id } }),
    User.updateOne({ _id: bob._id }, { $addToSet: { friends: alice._id } }),
  ]);

  console.log(`Seeded users: ${alice.customId} (${alice.email}) & ${bob.customId} (${bob.email})`);
  console.log('Login: alice@example.com / password123  OR  bob@example.com / password123');
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});