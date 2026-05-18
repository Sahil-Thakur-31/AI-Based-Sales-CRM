const mongoose = require("mongoose");
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const connectDatabase = require("../config/db");
const Leads = require("../models/leads");
const Deal = require("../models/deals");

const ASSIGNED_USER_ID = new mongoose.Types.ObjectId("6a093aeef3e411ad914fb533");
const INDUSTRY_ID = "6a094850da11c9565a8738f9";
const SOURCE_ID = new mongoose.Types.ObjectId("6a094850da11c9565a8738ec");
const LOCATION_ID = new mongoose.Types.ObjectId("6a097894da11c9565a873a5e");

const sharedLeadFields = {
  is_existing_company: false,
  is_existing_client: false,
  industry: INDUSTRY_ID,
  employee_count: 20,
  turnover_range: "3000000",
  Address: "Pune",
  website: "",
  source: SOURCE_ID,
  referred_by_user: null,
  expo_event_id: null,
  assigned_to: ASSIGNED_USER_ID,
  converted_to_deal: true,
  next_action: "",
  reason_for_lost: "",
  is_active: true,
  is_deleted: false,
  location: LOCATION_ID,
};

const dealProbabilityByStage = {
  P1: 20,
  P2: 40,
};

const scenarios = [
  {
    company_name: "Malabar Gold Pune",
    deal_name: "Malabar Gold Pune - Dec 2025",
    stage: "P2",
    deal_value_estimate: 72000,
    createdAt: new Date("2025-12-03T10:30:00.000Z"),
    expectedCloseDate: new Date("2026-02-01T10:30:00.000Z"),
  },
  {
    company_name: "Joyalukkas Pune",
    deal_name: "Joyalukkas Pune - Dec 2025",
    stage: "P2",
    deal_value_estimate: 84000,
    createdAt: new Date("2025-12-11T12:15:00.000Z"),
    expectedCloseDate: new Date("2026-02-10T12:15:00.000Z"),
  },
  {
    company_name: "Reliance Jewels Pune",
    deal_name: "Reliance Jewels Pune - Dec 2025",
    stage: "P1",
    deal_value_estimate: 56000,
    createdAt: new Date("2025-12-19T09:45:00.000Z"),
    expectedCloseDate: new Date("2026-02-18T09:45:00.000Z"),
  },
  {
    company_name: "CaratLane Pune",
    deal_name: "CaratLane Pune - Dec 2025",
    stage: "P1",
    deal_value_estimate: 63000,
    createdAt: new Date("2025-12-27T14:00:00.000Z"),
    expectedCloseDate: new Date("2026-02-25T14:00:00.000Z"),
  },
];

async function upsertLeadAndDeal(scenario) {
  const leadPayload = {
    ...sharedLeadFields,
    company_name: scenario.company_name,
    stage: scenario.stage,
    deal_value_estimate: scenario.deal_value_estimate,
    deal_name: scenario.deal_name,
    created_at: scenario.createdAt,
    updated_at: scenario.createdAt,
  };

  let lead = await Leads.findOne({
    company_name: scenario.company_name,
    created_at: scenario.createdAt,
  });

  if (!lead) {
    const insertedLead = await Leads.collection.insertOne(leadPayload);
    lead = await Leads.findById(insertedLead.insertedId);
  } else {
    await Leads.collection.updateOne({ _id: lead._id }, { $set: leadPayload });
  }

  const dealPayload = {
    deal_name: scenario.deal_name,
    lead_id: lead._id,
    assignedTo: ASSIGNED_USER_ID,
    assignedBy: ASSIGNED_USER_ID,
    stage: scenario.stage,
    dealValue: scenario.deal_value_estimate,
    probability: dealProbabilityByStage[scenario.stage] || 20,
    expectedCloseDate: scenario.expectedCloseDate,
    actualCloseDate: null,
    isActive: true,
    is_deleted: false,
    createdAt: scenario.createdAt,
    updatedAt: scenario.createdAt,
  };

  let deal = await Deal.findOne({ lead_id: lead._id, deal_name: scenario.deal_name });

  if (!deal) {
    deal = await Deal.create(dealPayload);
  } else {
    await Deal.updateOne({ _id: deal._id }, { $set: dealPayload });
  }

  await Leads.updateOne(
    { _id: lead._id },
    {
      $set: {
        converted_deal_id: deal._id,
        converted_to_deal: true,
        deal_name: scenario.deal_name,
        stage: scenario.stage,
        updated_at: scenario.createdAt,
      },
    }
  );

  return { lead, deal };
}

async function main() {
  await connectDatabase();

  const results = [];
  for (const scenario of scenarios) {
    results.push(await upsertLeadAndDeal(scenario));
  }

  console.log(
    JSON.stringify(
      {
        message: "December 2025 leads and deals seeded",
        created: scenarios.map((scenario) => ({
          company_name: scenario.company_name,
          deal_name: scenario.deal_name,
          stage: scenario.stage,
          created_at: scenario.createdAt.toISOString(),
        })),
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
