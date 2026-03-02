/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const https = require("https");
const dns = require("dns");
const readline = require("readline");
const { spawnSync } = require("child_process");
const mongoose = require("mongoose");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const Location = require("../models/location");

dns.setServers(["1.1.1.1", "8.8.8.8"]);

const DATA_DIR = path.join(__dirname, "..", "data", "location");
const ZIP_PATH = path.join(DATA_DIR, "allCountries.zip");
const TXT_PATH = path.join(DATA_DIR, "allCountries.txt");
const GEONAMES_ZIP_URL = "https://download.geonames.org/export/zip/allCountries.zip";

function parseArgs(argv) {
  const options = {
    download: false,
    file: TXT_PATH,
    limit: 0,
    batchSize: 2000,
    countryCode: "",
    replace: false,
    cityMode: "admin2"
  };

  for (const arg of argv) {
    if (arg === "--download") {
      options.download = true;
    } else if (arg === "--replace") {
      options.replace = true;
    } else if (arg.startsWith("--file=")) {
      options.file = arg.slice("--file=".length);
    } else if (arg.startsWith("--limit=")) {
      options.limit = Number(arg.slice("--limit=".length)) || 0;
    } else if (arg.startsWith("--batch=")) {
      options.batchSize = Math.max(100, Number(arg.slice("--batch=".length)) || 2000);
    } else if (arg.startsWith("--country=")) {
      options.countryCode = String(arg.slice("--country=".length) || "").trim().toUpperCase();
    } else if (arg.startsWith("--city-mode=")) {
      const mode = String(arg.slice("--city-mode=".length) || "").trim().toLowerCase();
      if (["admin2", "admin3", "auto"].includes(mode)) {
        options.cityMode = mode;
      }
    }
  }

  return options;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function resolveSrvHostsWithNslookup(srvHost) {
  const result = spawnSync("nslookup", [`-type=SRV`, `_mongodb._tcp.${srvHost}`], {
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error("nslookup failed to resolve SRV hosts");
  }

  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const hosts = [];
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/svr hostname\s*=\s*(\S+)/i);
    if (match?.[1]) {
      hosts.push(match[1].trim().replace(/\.$/, ""));
    }
  }

  const uniqueHosts = [...new Set(hosts)];
  if (!uniqueHosts.length) {
    throw new Error("No shard hosts found from nslookup output");
  }
  return uniqueHosts;
}

function inferReplicaSetName(hostname) {
  const hostLabel = String(hostname || "").split(".")[0] || "";
  const prefix = hostLabel.replace(/-shard-\d\d-\d\d$/i, "");
  const clusterId = prefix.startsWith("ac-") ? prefix.slice(3) : prefix;
  if (!clusterId) return "";
  return `atlas-${clusterId}-shard-0`;
}

function buildDirectMongoUriFromSrv(srvUri) {
  const parsed = new URL(srvUri);
  const srvHost = parsed.hostname;
  const dbName = parsed.pathname.replace(/^\/+/, "") || "test";
  const hosts = resolveSrvHostsWithNslookup(srvHost);
  const replicaSet = inferReplicaSetName(hosts[0]);

  const username = decodeURIComponent(parsed.username || "");
  const password = decodeURIComponent(parsed.password || "");
  const authPart =
    username || password
      ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
      : "";

  const params = new URLSearchParams(parsed.search || "");
  if (!params.get("ssl") && !params.get("tls")) params.set("ssl", "true");
  if (authPart && !params.get("authSource")) params.set("authSource", "admin");
  if (replicaSet && !params.get("replicaSet")) params.set("replicaSet", replicaSet);
  if (!params.get("retryWrites")) params.set("retryWrites", "true");
  if (!params.get("w")) params.set("w", "majority");

  const qs = params.toString();
  return `mongodb://${authPart}${hosts.join(",")}/${dbName}${qs ? `?${qs}` : ""}`;
}

async function connectWithFallback(uri) {
  try {
    await mongoose.connect(uri);
    return { uriUsed: uri, fallbackUsed: false };
  } catch (err) {
    const isSrvDnsError =
      uri.startsWith("mongodb+srv://") &&
      String(err?.message || "").toLowerCase().includes("querysrv");

    if (!isSrvDnsError) throw err;

    console.warn("SRV DNS failed. Retrying with direct Atlas hosts via nslookup...");
    const directUri = buildDirectMongoUriFromSrv(uri);
    await mongoose.connect(directUri);
    return { uriUsed: directUri, fallbackUsed: true };
  }
}

function downloadFile(url, destinationPath) {
  return new Promise((resolve, reject) => {
    const handleResponse = (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, destinationPath).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download dataset. Status: ${res.statusCode}`));
        return;
      }

      const file = fs.createWriteStream(destinationPath);
      res.pipe(file);
      file.on("finish", () => {
        file.close(() => resolve());
      });
      file.on("error", (err) => reject(err));
    };

    https.get(url, handleResponse).on("error", reject);
  });
}

function extractZipWindows(zipPath, outputDir) {
  const psCommand = `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${outputDir.replace(/'/g, "''")}' -Force`;
  const result = spawnSync("powershell", ["-NoProfile", "-Command", psCommand], {
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error("Failed to extract zip with PowerShell");
  }
}

function extractZipPortable(zipPath, outputDir) {
  if (process.platform === "win32") {
    extractZipWindows(zipPath, outputDir);
    return;
  }

  const result = spawnSync("tar", ["-xf", zipPath, "-C", outputDir], {
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error("Failed to extract zip with tar");
  }
}

function isoToCountryName(isoCode) {
  if (!isoCode) return "";
  try {
    const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
    return displayNames.of(isoCode) || isoCode;
  } catch (_err) {
    return isoCode;
  }
}

function clean(value) {
  return String(value || "").trim();
}

function resolveCity(adminName2, adminName3, placeName, cityMode) {
  if (cityMode === "admin3") {
    return adminName3 || adminName2 || placeName;
  }
  if (cityMode === "auto") {
    if (adminName2) return adminName2;
    if (adminName3) return adminName3;
    return placeName;
  }
  // admin2 mode keeps Indian districts like "Pune" grouped together.
  return adminName2 || adminName3 || placeName;
}

function buildLocationDoc(parts, options) {
  const countryCode = clean(parts[0]).toUpperCase();
  const pincode = clean(parts[1]);
  const placeName = clean(parts[2]);
  const adminName1 = clean(parts[3]); // state/province
  const adminName2 = clean(parts[5]); // district/county
  const adminName3 = clean(parts[7]); // city/subdivision

  const country = isoToCountryName(countryCode);
  const state = adminName1 || "";
  const district = adminName2 || adminName3 || "";
  const city = resolveCity(adminName2, adminName3, placeName, options.cityMode);
  const area = placeName;
  const zone = adminName3 || area;

  if (!country || !city || !pincode || !area) {
    return null;
  }

  return {
    country,
    state,
    district,
    city,
    pincode,
    area,
    State: state,
    zone
  };
}

async function flushBatch(batchMap) {
  const now = new Date();
  const ops = Array.from(batchMap.values()).map((doc) => ({
    updateOne: {
      filter: {
        country: doc.country,
        state: doc.state,
        district: doc.district,
        city: doc.city,
        pincode: doc.pincode,
        area: doc.area
      },
      update: {
        $set: {
          country: doc.country,
          state: doc.state,
          district: doc.district,
          city: doc.city,
          pincode: doc.pincode,
          area: doc.area,
          State: doc.State,
          zone: doc.zone,
          updatedAt: now
        },
        $setOnInsert: {
          createdAt: now
        }
      },
      upsert: true
    }
  }));

  if (!ops.length) return { written: 0, upserts: 0, modified: 0 };
  const result = await Location.bulkWrite(ops, { ordered: false });
  return {
    written: ops.length,
    upserts: result.upsertedCount || 0,
    modified: result.modifiedCount || 0
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  ensureDir(DATA_DIR);

  if (options.download || !fs.existsSync(options.file)) {
    console.log("Downloading global postal dataset...");
    await downloadFile(GEONAMES_ZIP_URL, ZIP_PATH);
    console.log("Extracting dataset...");
    extractZipPortable(ZIP_PATH, DATA_DIR);
  }

  if (!fs.existsSync(options.file)) {
    throw new Error(`Dataset text file not found: ${options.file}`);
  }

  if (!process.env.CONN) {
    throw new Error("Missing CONN in backend/.env");
  }

  const connectionInfo = await connectWithFallback(process.env.CONN);
  if (connectionInfo.fallbackUsed) {
    console.log("Mongo connected using direct host fallback. Import started...");
  } else {
    console.log("Mongo connected. Import started...");
  }
  console.log(`City mapping mode: ${options.cityMode}`);

  if (options.replace) {
    console.log("Clearing existing location collection before import...");
    await Location.deleteMany({});
  }

  const stream = fs.createReadStream(options.file, { encoding: "utf8" });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let readRows = 0;
  let acceptedRows = 0;
  let skippedRows = 0;
  let writtenRows = 0;
  let upsertedRows = 0;
  let modifiedRows = 0;

  let batchMap = new Map();

  for await (const line of reader) {
    if (!line || line.startsWith("#")) continue;

    readRows += 1;
    if (options.limit > 0 && readRows > options.limit) break;

    const parts = line.split("\t");
    if (parts.length < 8) {
      skippedRows += 1;
      continue;
    }

    const countryCode = clean(parts[0]).toUpperCase();
    if (options.countryCode && countryCode !== options.countryCode) {
      continue;
    }

    const doc = buildLocationDoc(parts, options);
    if (!doc) {
      skippedRows += 1;
      continue;
    }

    acceptedRows += 1;
    const key = `${doc.country}|${doc.state}|${doc.district}|${doc.city}|${doc.pincode}|${doc.area}`;
    batchMap.set(key, doc);

    if (batchMap.size >= options.batchSize) {
      const stats = await flushBatch(batchMap);
      writtenRows += stats.written;
      upsertedRows += stats.upserts;
      modifiedRows += stats.modified;
      batchMap = new Map();
      if (readRows % 50000 === 0) {
        console.log(`Processed ${readRows.toLocaleString()} rows...`);
      }
    }
  }

  if (batchMap.size) {
    const stats = await flushBatch(batchMap);
    writtenRows += stats.written;
    upsertedRows += stats.upserts;
    modifiedRows += stats.modified;
  }

  await mongoose.disconnect();

  console.log("Global location import complete.");
  console.log(`Rows read: ${readRows.toLocaleString()}`);
  console.log(`Rows accepted: ${acceptedRows.toLocaleString()}`);
  console.log(`Rows skipped: ${skippedRows.toLocaleString()}`);
  console.log(`Bulk ops written: ${writtenRows.toLocaleString()}`);
  console.log(`Documents upserted: ${upsertedRows.toLocaleString()}`);
  console.log(`Documents updated: ${modifiedRows.toLocaleString()}`);
}

main().catch(async (err) => {
  console.error("Import failed:", err.message || err);
  try {
    await mongoose.disconnect();
  } catch (_err) {
    // no-op
  }
  process.exit(1);
});
