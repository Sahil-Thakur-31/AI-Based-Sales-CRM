const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const connectDatabase = require("./config/db");
const Source = require("./models/sources");
const Industry = require("./models/industries");

const SOURCES = [
  { name: "Reference", url: "" },
  { name: "Event & Expo", url: "" },
  { name: "PredictHQ", url: "https://www.predicthq.com/" },
  { name: "Meetup", url: "https://www.meetup.com/" },
  { name: "Eventbrite", url: "https://www.eventbrite.com/" },
  { name: "MCCIA", url: "https://mcciapune.com/events/events-landing-page/" },
  { name: "NASSCOM", url: "https://nasscom.in/events" },
  { name: "MEA", url: "https://www.meainternationalexpo.com/" },
  { name: "IndiaMART", url: "https://www.indiamart.com/" },
  { name: "Google Maps", url: "https://www.google.com/maps" }
];

const INDUSTRIES = [
  {
    name: "Technology",
    description: "software, saas, ai, artificial intelligence, machine learning, cloud, cybersecurity, data, automation, it services, startup, developer, technology conference"
  },
  {
    name: "Manufacturing",
    description: "manufacturer, machinery, engineering, industrial, plant, factory, automation, production, manufacturing expo"
  },
  {
    name: "Pharma",
    description: "pharma, pharmaceutical, healthcare, biotech, life sciences, medical, drugs, formulations, pharma expo"
  },
  {
    name: "Electronics",
    description: "electronics, electrical, semiconductor, embedded, hardware, components, iot, electronics expo"
  },
  {
    name: "Construction",
    description: "construction, real estate, builders, infrastructure, architecture, civil, property, construction expo"
  },
  {
    name: "Education",
    description: "education, edtech, training, workshop, institute, university, learning, student, academic"
  },
  {
    name: "Finance",
    description: "finance, fintech, banking, accounting, investment, insurance, payments, wealth"
  },
  {
    name: "Marketing",
    description: "marketing, advertising, sales, branding, digital marketing, media, growth"
  },
  {
    name: "Business",
    description: "business, entrepreneurship, networking, sme, msme, trade, commerce, leadership"
  },
  {
    name: "Logistics",
    description: "logistics, supply chain, warehouse, transport, shipping, freight, distribution"
  }
];

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function upsertByName(Model, rows) {
  const now = new Date();
  for (const row of rows) {
    await Model.findOneAndUpdate(
      { name: { $regex: `^${escapeRegExp(row.name)}$`, $options: "i" } },
      {
        $set: {
          ...row,
          is_deleted: false,
          updatedAt: now
        },
        $setOnInsert: {
          createdAt: now
        }
      },
      { upsert: true, returnDocument: "after" }
    );
  }
}

async function seedScraperMasterData() {
  await connectDatabase();
  await upsertByName(Source, SOURCES);
  await upsertByName(Industry, INDUSTRIES);
  console.log(`Seeded sources: ${SOURCES.length}`);
  console.log(`Seeded industries: ${INDUSTRIES.length}`);
}

seedScraperMasterData()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
