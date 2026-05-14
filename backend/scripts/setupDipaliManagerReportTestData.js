const mongoose = require("mongoose");
require("dotenv").config();

require("../models/roles");
const User = require("../models/users");
const Team = require("../models/teams");
const SalesTarget = require("../models/sales_targets");
const Leads = require("../models/leads");
const Deal = require("../models/deals");
const Quotation = require("../models/quatations");

const TEST_PREFIX = "REPORT TEST | Dipali";

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function getFourMonthRange(now = new Date()) {
  const month = now.getMonth();
  const startMonth = month < 4 ? 0 : month < 8 ? 4 : 8;
  const start = new Date(now.getFullYear(), startMonth, 1);
  const end = new Date(now.getFullYear(), startMonth + 4, 0, 23, 59, 59, 999);
  return { start, end };
}

function dateInMonth(year, monthIndex, day) {
  return new Date(year, monthIndex, day, 11, 0, 0, 0);
}

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findUserByNameAndRole(name, roleName) {
  return User.findOne({
    name,
    is_deleted: { $ne: true },
    is_active: true,
  })
    .populate("role", "name")
    .lean()
    .then((user) => {
      if (!user || String(user?.role?.name || "").toLowerCase() !== String(roleName).toLowerCase()) {
        throw new Error(`Required user not found: ${name} (${roleName})`);
      }
      return user;
    });
}

async function upsertTarget(filter, payload) {
  await SalesTarget.updateOne(
    filter,
    {
      $set: {
        ...payload,
        updated_at: new Date(),
      },
      $setOnInsert: {
        created_at: new Date(),
      },
    },
    { upsert: true }
  );
}

async function createLeadForDeal({
  owner,
  manager,
  companyName,
  createdAt,
  dealEstimate,
  converted,
}) {
  const lead = await Leads.create({
    company_name: companyName,
    lead_temperature: "hot",
    status: converted ? "converted" : "qualified",
    assigned_to: owner._id,
    deal_value_estimate: dealEstimate,
    converted_to_deal: converted,
    created_at: createdAt,
    updated_at: createdAt,
    next_action: converted ? "Closed through report testing" : "Negotiation in progress",
    is_deleted: false,
    is_active: true,
    referred_by_user: manager._id,
  });

  return lead;
}

async function createDealWithQuotation({
  owner,
  manager,
  label,
  createdAt,
  closeDate,
  expectedCloseDate,
  stage,
  dealValue,
  subtotalAmount,
  discountAmount,
}) {
  const lead = await createLeadForDeal({
    owner,
    manager,
    companyName: `${TEST_PREFIX} ${label}`,
    createdAt,
    dealEstimate: dealValue,
    converted: true,
  });

  const deal = await Deal.create({
    deal_name: `${TEST_PREFIX} ${label}`,
    lead_id: lead._id,
    assignedTo: owner._id,
    assignedBy: manager._id,
    stage,
    dealValue,
    probability: stage === "P7" ? 100 : stage === "P6" ? 0 : 55,
    actualCloseDate: ["P6", "P7"].includes(stage) ? closeDate : null,
    expectedCloseDate: ["P6", "P7"].includes(stage) ? null : expectedCloseDate,
    isActive: !["P6", "P7"].includes(stage),
    is_deleted: false,
    createdAt,
    updatedAt: ["P6", "P7"].includes(stage) ? closeDate || createdAt : expectedCloseDate || createdAt,
  });

  await Leads.updateOne(
    { _id: lead._id },
    {
      $set: {
        converted_deal_id: deal._id,
        converted_to_deal: true,
        deal_name: deal.deal_name,
        status: "converted",
      },
    }
  );

  if (stage === "P7") {
    const taxAmount = Math.round(subtotalAmount * 0.18);
    await Quotation.create({
      quoteNumber: `RT-DIPALI-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      dealId: deal._id,
      leadId: lead._id,
      quoteType: "deal",
      createdBy: manager._id,
      assignedTo: owner._id,
      quoteDate: createdAt,
      validUntil: new Date(closeDate.getTime() + 15 * 24 * 60 * 60 * 1000),
      subtotalAmount,
      taxAmount,
      discountAmount,
      grandTotal: subtotalAmount + taxAmount - discountAmount,
      currency: "INR",
      status: "approved",
      version: 1,
      notes: `${TEST_PREFIX} quotation`,
      paymentTerms: "Net 15",
      isActive: true,
      is_deleted: false,
      approvedBy: manager._id,
      approvedAt: closeDate,
    });
  }

  return deal;
}

async function main() {
  await mongoose.connect(process.env.CONN);

  const manager = await findUserByNameAndRole("Dipali M", "Manager");
  const members = await Promise.all([
    findUserByNameAndRole("Dipali U", "User"),
    findUserByNameAndRole("Ambadas U", "User"),
    findUserByNameAndRole("Sahil U", "User"),
  ]);

  const existingTeam =
    (await Team.findOne({ "teamLeads.userId": manager._id })) ||
    (await Team.findOne({ name: "developer" }));

  const teamPayload = {
    name: existingTeam?.name || "developer",
    teamLeads: [{ userId: manager._id }],
    members: members.map((member) => ({ userId: member._id })),
    createdBy: existingTeam?.createdBy || manager._id,
  };

  const team = existingTeam
    ? await Team.findByIdAndUpdate(existingTeam._id, { $set: teamPayload }, { returnDocument: "after" })
    : await Team.create(teamPayload);

  const now = new Date();
  const year = now.getFullYear();
  const monthlyStart = startOfMonth(now);
  const monthlyEnd = endOfMonth(now);
  const quarterlyRange = getFourMonthRange(now);

  const targetRows = [
    { user: manager, monthlyRevenue: 260000, monthlyDeals: 2, quarterlyRevenue: 620000, quarterlyDeals: 5 },
    { user: members[0], monthlyRevenue: 190000, monthlyDeals: 2, quarterlyRevenue: 470000, quarterlyDeals: 4 },
    { user: members[1], monthlyRevenue: 180000, monthlyDeals: 2, quarterlyRevenue: 430000, quarterlyDeals: 4 },
    { user: members[2], monthlyRevenue: 150000, monthlyDeals: 2, quarterlyRevenue: 390000, quarterlyDeals: 4 },
  ];

  for (const row of targetRows) {
    await upsertTarget(
      {
        user_id: row.user._id,
        team_id: team._id,
        scope_type: "user",
        period_type: "monthly",
        period_start: monthlyStart,
        period_end: monthlyEnd,
      },
      {
        user_id: row.user._id,
        team_id: team._id,
        assigned_by: manager._id,
        scope_type: "user",
        period_type: "monthly",
        period_start: monthlyStart,
        period_end: monthlyEnd,
        revenue_target: row.monthlyRevenue,
        deal_target: row.monthlyDeals,
        followup_target: 6,
        notes: `${TEST_PREFIX} monthly target`,
        status: "active",
      }
    );

    await upsertTarget(
      {
        user_id: row.user._id,
        team_id: team._id,
        scope_type: "user",
        period_type: "quarterly",
        period_start: quarterlyRange.start,
        period_end: quarterlyRange.end,
      },
      {
        user_id: row.user._id,
        team_id: team._id,
        assigned_by: manager._id,
        scope_type: "user",
        period_type: "quarterly",
        period_start: quarterlyRange.start,
        period_end: quarterlyRange.end,
        revenue_target: row.quarterlyRevenue,
        deal_target: row.quarterlyDeals,
        followup_target: 14,
        notes: `${TEST_PREFIX} four-month target`,
        status: "active",
      }
    );
  }

  await upsertTarget(
    {
      team_id: team._id,
      scope_type: "team",
      period_type: "monthly",
      period_start: monthlyStart,
      period_end: monthlyEnd,
    },
    {
      team_id: team._id,
      assigned_by: manager._id,
      scope_type: "team",
      period_type: "monthly",
      period_start: monthlyStart,
      period_end: monthlyEnd,
      revenue_target: targetRows.reduce((sum, row) => sum + row.monthlyRevenue, 0),
      deal_target: targetRows.reduce((sum, row) => sum + row.monthlyDeals, 0),
      notes: `${TEST_PREFIX} team monthly target`,
      status: "active",
    }
  );

  await upsertTarget(
    {
      team_id: team._id,
      scope_type: "team",
      period_type: "quarterly",
      period_start: quarterlyRange.start,
      period_end: quarterlyRange.end,
    },
    {
      team_id: team._id,
      assigned_by: manager._id,
      scope_type: "team",
      period_type: "quarterly",
      period_start: quarterlyRange.start,
      period_end: quarterlyRange.end,
      revenue_target: targetRows.reduce((sum, row) => sum + row.quarterlyRevenue, 0),
      deal_target: targetRows.reduce((sum, row) => sum + row.quarterlyDeals, 0),
      notes: `${TEST_PREFIX} team four-month target`,
      status: "active",
    }
  );

  const dealNameRegex = new RegExp(`^${escapeRegex(TEST_PREFIX)}`);
  const quotationNoteRegex = new RegExp(`^${escapeRegex(TEST_PREFIX)}`);

  const existingTestDeals = await Deal.find({ deal_name: dealNameRegex }, { _id: 1 }).lean();
  const existingTestLeadIds = await Leads.find({ company_name: dealNameRegex }, { _id: 1 }).lean();

  if (existingTestDeals.length) {
    await Quotation.deleteMany({ dealId: { $in: existingTestDeals.map((doc) => doc._id) } });
  }
  await Quotation.deleteMany({ notes: quotationNoteRegex });
  await Deal.deleteMany({ deal_name: dealNameRegex });
  await Leads.deleteMany({ company_name: dealNameRegex, _id: { $in: existingTestLeadIds.map((doc) => doc._id) } });

  const usersByName = new Map([
    [manager.name, manager],
    ...members.map((member) => [member.name, member]),
  ]);

  const scenarios = [
    {
      owner: usersByName.get("Dipali M"),
      label: "Dipali M Jan Won",
      createdAt: dateInMonth(year, 0, 4),
      closeDate: dateInMonth(year, 0, 14),
      stage: "P7",
      dealValue: 180000,
      subtotalAmount: 172000,
      discountAmount: 7000,
    },
    {
      owner: usersByName.get("Dipali M"),
      label: "Dipali M Current Won",
      createdAt: dateInMonth(year, now.getMonth(), 2),
      closeDate: dateInMonth(year, now.getMonth(), 6),
      stage: "P7",
      dealValue: 225000,
      subtotalAmount: 215000,
      discountAmount: 10000,
    },
    {
      owner: usersByName.get("Dipali M"),
      label: "Dipali M Current Open",
      createdAt: dateInMonth(year, now.getMonth(), 8),
      expectedCloseDate: dateInMonth(year, now.getMonth(), 24),
      stage: "P2",
      dealValue: 95000,
    },
    {
      owner: usersByName.get("Dipali U"),
      label: "Dipali U Mar Won",
      createdAt: dateInMonth(year, 2, 3),
      closeDate: dateInMonth(year, 2, 10),
      stage: "P7",
      dealValue: 145000,
      subtotalAmount: 140000,
      discountAmount: 5000,
    },
    {
      owner: usersByName.get("Dipali U"),
      label: "Dipali U Current Won",
      createdAt: dateInMonth(year, now.getMonth(), 4),
      closeDate: dateInMonth(year, now.getMonth(), 9),
      stage: "P7",
      dealValue: 155000,
      subtotalAmount: 150000,
      discountAmount: 5000,
    },
    {
      owner: usersByName.get("Dipali U"),
      label: "Dipali U Current Lost",
      createdAt: dateInMonth(year, now.getMonth(), 11),
      closeDate: dateInMonth(year, now.getMonth(), 21),
      stage: "P6",
      dealValue: 60000,
    },
    {
      owner: usersByName.get("Ambadas U"),
      label: "Ambadas U Apr Won",
      createdAt: dateInMonth(year, 3, 5),
      closeDate: dateInMonth(year, 3, 12),
      stage: "P7",
      dealValue: 135000,
      subtotalAmount: 130000,
      discountAmount: 5000,
    },
    {
      owner: usersByName.get("Ambadas U"),
      label: "Ambadas U Current Won",
      createdAt: dateInMonth(year, now.getMonth(), 6),
      closeDate: dateInMonth(year, now.getMonth(), 13),
      stage: "P7",
      dealValue: 165000,
      subtotalAmount: 160000,
      discountAmount: 7000,
    },
    {
      owner: usersByName.get("Ambadas U"),
      label: "Ambadas U Current Open",
      createdAt: dateInMonth(year, now.getMonth(), 9),
      expectedCloseDate: dateInMonth(year, now.getMonth(), 27),
      stage: "P2",
      dealValue: 90000,
    },
    {
      owner: usersByName.get("Sahil U"),
      label: "Sahil U Feb Won",
      createdAt: dateInMonth(year, 1, 10),
      closeDate: dateInMonth(year, 1, 18),
      stage: "P7",
      dealValue: 120000,
      subtotalAmount: 118000,
      discountAmount: 3000,
    },
    {
      owner: usersByName.get("Sahil U"),
      label: "Sahil U Current Won",
      createdAt: dateInMonth(year, now.getMonth(), 10),
      closeDate: dateInMonth(year, now.getMonth(), 17),
      stage: "P7",
      dealValue: 140000,
      subtotalAmount: 136000,
      discountAmount: 4000,
    },
    {
      owner: usersByName.get("Sahil U"),
      label: "Sahil U Current Lost",
      createdAt: dateInMonth(year, now.getMonth(), 14),
      closeDate: dateInMonth(year, now.getMonth(), 23),
      stage: "P6",
      dealValue: 50000,
    },
  ];

  for (const scenario of scenarios) {
    await createDealWithQuotation({
      owner: scenario.owner,
      manager,
      label: scenario.label,
      createdAt: scenario.createdAt,
      closeDate: scenario.closeDate,
      expectedCloseDate: scenario.expectedCloseDate,
      stage: scenario.stage,
      dealValue: scenario.dealValue,
      subtotalAmount: scenario.subtotalAmount || 0,
      discountAmount: scenario.discountAmount || 0,
    });
  }

  console.log(JSON.stringify({
    message: "Dipali manager report test data prepared",
    team: {
      id: String(team._id),
      name: team.name,
      lead: manager.name,
      members: members.map((member) => member.name),
    },
    targetsCreatedFor: [manager.name, ...members.map((member) => member.name)],
    dealsCreated: scenarios.length,
    wonDealsWithQuotations: scenarios.filter((scenario) => scenario.stage === "P7").length,
  }, null, 2));

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
