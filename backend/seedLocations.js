const fs = require("fs");
const path = require("path");
const readline = require("readline");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const connectDatabase = require("./config/db");
const Location = require("./models/location");

const SOURCE_FILE = path.join(__dirname, "data", "location", "allCountries.txt");
const BATCH_SIZE = 1000;

function clean(value) {
  return String(value || "").trim();
}

function parseLocationLine(line) {
  const columns = line.split("\t");
  if (columns.length < 4) return null;

  const country = clean(columns[0]);
  const pincode = clean(columns[1]);
  const area = clean(columns[2]);
  const state = clean(columns[3]);
  const district = clean(columns[5]);
  const city = clean(columns[7]) || area;

  if (!country || !pincode) return null;

  const importKey = [country, pincode, area, state, district, city]
    .map((part) => part.toLowerCase())
    .join("|");

  return {
    country,
    pincode,
    area,
    zone: area,
    state,
    State: state,
    district,
    city,
    importKey,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

async function flushBatch(batch) {
  if (!batch.length) return 0;
  const uniqueRows = [...new Map(batch.map((row) => [row.importKey, row])).values()];

  await Location.bulkWrite(
    uniqueRows.map((row) => {
      const { createdAt, ...setFields } = row;
      return {
        updateOne: {
          filter: { importKey: row.importKey },
          update: {
            $set: { ...setFields, updatedAt: new Date() },
            $setOnInsert: { createdAt }
          },
          upsert: true
        }
      }
    }),
    { ordered: false }
  );
  return uniqueRows.length;
}

async function seedLocations() {
  await connectDatabase();

  if (!fs.existsSync(SOURCE_FILE)) {
    throw new Error(`Location source file not found: ${SOURCE_FILE}`);
  }

  const force = process.argv.includes("--force");
  const existingCount = await Location.estimatedDocumentCount();

  if (force && existingCount) {
    await Location.deleteMany({});
    console.log(`Deleted existing location records: ${existingCount}`);
  }

  let batch = [];
  let inserted = 0;
  let scanned = 0;

  const reader = readline.createInterface({
    input: fs.createReadStream(SOURCE_FILE, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  for await (const line of reader) {
    scanned += 1;
    const row = parseLocationLine(line);
    if (!row) continue;

    batch.push(row);

    if (batch.length >= BATCH_SIZE) {
      inserted += await flushBatch(batch);
      batch = [];
      if (inserted % 50000 === 0) {
        console.log(`Inserted ${inserted} locations...`);
      }
    }
  }

  inserted += await flushBatch(batch);
  await Location.syncIndexes();

  console.log(`Location seed complete. Scanned: ${scanned}, inserted: ${inserted}`);
}

seedLocations()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
