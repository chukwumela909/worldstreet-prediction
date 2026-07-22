import mongoose from "mongoose";
import { config } from "./config.js";

export async function connectDatabase() {
  if (mongoose.connection.readyState === 1) return mongoose;

  return mongoose.connect(config.MONGODB_URI, {
    dbName: config.MONGODB_DB_NAME,
    bufferCommands: false,
    serverSelectionTimeoutMS: 10_000,
  });
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

export function isDatabaseReady() {
  return mongoose.connection.readyState === 1;
}
