const mongoose = require("mongoose");
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const connectDatabase = require("../config/db");
const Leads = require("../models/leads");

const APRIL_1_2026 = new Date("2026-04-01T12:00:00.000Z");

const sharedLeadFields = {
  is_existing_company: false,
  is_existing_client: false,
  industry: "6a094850da11c9565a8738f9",
  employee_count: 20,
  turnover_range: "3000000",
  Address: "Pune",
  website: "",
  source: new mongoose.Types.ObjectId("6a094850da11c9565a8738ec"),
  referred_by_user: null,
  expo_event_id: null,
  assigned_to: new mongoose.Types.ObjectId("6a093aeef3e411ad914fb533"),
  stage: "P2",
  converted_to_deal: false,
  deal_name: "",
  next_action: "",
  reason_for_lost: "",
  is_active: true,
  is_deleted: false,
  location: new mongoose.Types.ObjectId("6a097894da11c9565a873a5e"),
};

const leadsToSeed = [
  {
    company_name: "Tanishq Jwellers",
    deal_value_estimate: 46000,
  },
  {
    company_name: "PNG Jewellers Pune",
    deal_value_estimate: 52000,
  },
  {
    company_name: "Kalyan Jewellers Pune",
    deal_value_estimate: 61000,
  },
];

async function main() {
  await connectDatabase();

  let inserted = 0;
  let updated = 0;

  for (const lead of leadsToSeed) {
    const filter = {
      company_name: lead.company_name,
      created_at: APRIL_1_2026,
    };

    const payload = {
      ...sharedLeadFields,
      ...lead,
      created_at: APRIL_1_2026,
      updated_at: APRIL_1_2026,
    };

    const existing = await Leads.findOne(filter, { _id: 1 }).lean();

    if (existing) {
      await Leads.collection.updateOne(
        { _id: existing._id },
        { $set: payload }
      );
      updated += 1;
      continue;
    }

    await Leads.collection.insertOne(payload);
    inserted += 1;
  }

  console.log(
    JSON.stringify(
      {
        message: "April 1, 2026 leads seeded",
        inserted,
        updated,
        company_names: leadsToSeed.map((lead) => lead.company_name),
        created_at: APRIL_1_2026.toISOString(),
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
