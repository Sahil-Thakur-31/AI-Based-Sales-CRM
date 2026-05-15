const dns = require("dns");
const mongoose = require("mongoose");
require("dotenv").config();

dns.setServers(["1.1.1.1", "8.8.8.8"]);

const dbUrl = process.env.CONN;

async function connectDatabase() {
  if (!dbUrl) {
    throw new Error("Missing CONN in backend/.env");
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (mongoose.connection.readyState === 2) {
    return mongoose.connection.asPromise();
  }

  await mongoose.connect(dbUrl, {
    serverSelectionTimeoutMS: 10000
  });

  console.log("DB connected");
  return mongoose.connection;
}

module.exports = connectDatabase;
