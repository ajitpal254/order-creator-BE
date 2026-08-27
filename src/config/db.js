import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

export const connectDB = async () => {
  try {
    const connUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ha_overseas_order_creator';
    mongoose.set('strictQuery', false);
    const conn = await mongoose.connect(connUri, {
      serverSelectionTimeoutMS: 8000,
    });
    console.log(`[Database] MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error(`[Database Error] Connection failed: ${error.message}`);
    // If remote connection fails or has auth/network issues, do not crash immediately so dev continues
    console.warn('[Database] Running with caution. Please check MONGODB_URI connectivity or IP whitelist.');
  }
};
