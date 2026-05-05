require("dotenv").config();
require("./config/db");
const mongoose = require("mongoose");
const User = require("./models/users");
const Leads = require("./models/leads");
const Deal = require("./models/deals");
const Followup = require("./models/followUp");

const d = (months) => {
  const dt = new Date();
  dt.setMonth(dt.getMonth() + months);
  return dt;
};
const past = (months) => d(-Math.abs(months));
const future = (months) => d(Math.abs(months));

async function seed() {
  await new Promise((r) => setTimeout(r, 2000)); // wait for DB

  const users = await User.find({ is_deleted: { $ne: true } }, { _id: 1, name: 1 }).limit(4).lean();
  if (!users.length) { console.log("No users found. Create users first."); process.exit(1); }

  const [u1, u2, u3, u4] = [users[0], users[1] || users[0], users[2] || users[0], users[3] || users[0]];
  console.log("Using users:", users.map(u => u.name || u._id).join(", "));

  // ── LEADS ──────────────────────────────────────────────────────────────────
  const leadDocs = await Leads.insertMany([
    { company_name: "TechNova Solutions", lead_temperature: "hot",  status: "converted",  assigned_to: u1._id, deal_value_estimate: 250000, created_at: past(2), is_deleted: false },
    { company_name: "GreenLeaf Exports",  lead_temperature: "warm", status: "qualified",  assigned_to: u2._id, deal_value_estimate: 120000, created_at: past(1), is_deleted: false },
    { company_name: "BlueSky Logistics",  lead_temperature: "hot",  status: "converted",  assigned_to: u1._id, deal_value_estimate: 350000, created_at: past(3), is_deleted: false },
    { company_name: "Sunrise Retail",     lead_temperature: "warm", status: "contacted",  assigned_to: u3._id, deal_value_estimate:  80000, created_at: past(1), is_deleted: false },
    { company_name: "Pinnacle Finance",   lead_temperature: "hot",  status: "converted",  assigned_to: u2._id, deal_value_estimate: 500000, created_at: past(4), is_deleted: false },
    { company_name: "Coastal Pharma",     lead_temperature: "cold", status: "new",        assigned_to: u4._id, deal_value_estimate:  60000, created_at: past(0), is_deleted: false },
    { company_name: "InnoTech Pvt Ltd",   lead_temperature: "warm", status: "qualified",  assigned_to: u3._id, deal_value_estimate: 180000, created_at: past(1), is_deleted: false },
    { company_name: "Sigma Constructions",lead_temperature: "cold", status: "rejected",   assigned_to: u4._id, deal_value_estimate:  40000, created_at: past(2), is_deleted: false },
    { company_name: "Horizon Edu Tech",   lead_temperature: "hot",  status: "converted",  assigned_to: u1._id, deal_value_estimate: 300000, created_at: past(2), is_deleted: false },
    { company_name: "Vertex Automations", lead_temperature: "warm", status: "contacted",  assigned_to: u2._id, deal_value_estimate:  90000, created_at: past(0), is_deleted: false },
  ]);
  console.log("Leads inserted:", leadDocs.length);

  // ── DEALS ──────────────────────────────────────────────────────────────────
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const dealDocs = await Deal.insertMany([
    // Won this month → show in KPI revenue
    { deal_name: "TechNova - ERP Implementation",  lead_id: leadDocs[0]._id, assignedTo: u1._id, assignedBy: u1._id, stage: "P7", status: "won",  dealValue: 250000, probability: 100, isActive: false, is_deleted: false, actualCloseDate: new Date(thisMonthStart.getFullYear(), thisMonthStart.getMonth(), 5),  createdAt: past(2) },
    { deal_name: "BlueSky - Fleet Management",      lead_id: leadDocs[2]._id, assignedTo: u1._id, assignedBy: u1._id, stage: "P7", status: "won",  dealValue: 350000, probability: 100, isActive: false, is_deleted: false, actualCloseDate: new Date(thisMonthStart.getFullYear(), thisMonthStart.getMonth(), 8),  createdAt: past(3) },
    { deal_name: "Pinnacle - Financial Suite",      lead_id: leadDocs[4]._id, assignedTo: u2._id, assignedBy: u1._id, stage: "P7", status: "won",  dealValue: 180000, probability: 100, isActive: false, is_deleted: false, actualCloseDate: new Date(thisMonthStart.getFullYear(), thisMonthStart.getMonth(), 12), createdAt: past(4) },
    { deal_name: "Horizon - LMS Platform",          lead_id: leadDocs[8]._id, assignedTo: u1._id, assignedBy: u1._id, stage: "P7", status: "won",  dealValue: 120000, probability: 100, isActive: false, is_deleted: false, actualCloseDate: new Date(thisMonthStart.getFullYear(), thisMonthStart.getMonth(), 15), createdAt: past(2) },
    { deal_name: "InnoTech - CRM Setup",            lead_id: leadDocs[6]._id, assignedTo: u3._id, assignedBy: u1._id, stage: "P7", status: "won",  dealValue:  95000, probability: 100, isActive: false, is_deleted: false, actualCloseDate: new Date(thisMonthStart.getFullYear(), thisMonthStart.getMonth(), 18), createdAt: past(1) },
    // Lost this month → reduces win rate
    { deal_name: "Sigma - Infrastructure Deal",     lead_id: leadDocs[7]._id, assignedTo: u4._id, assignedBy: u1._id, stage: "P3", status: "lost", dealValue:  40000, probability:   0, isActive: false, is_deleted: false, actualCloseDate: new Date(thisMonthStart.getFullYear(), thisMonthStart.getMonth(), 10), createdAt: past(2) },
    { deal_name: "Coastal - Basic Package",         lead_id: leadDocs[5]._id, assignedTo: u4._id, assignedBy: u1._id, stage: "P2", status: "lost", dealValue:  60000, probability:   0, isActive: false, is_deleted: false, actualCloseDate: new Date(thisMonthStart.getFullYear(), thisMonthStart.getMonth(), 20), createdAt: past(1) },
    // Open deals (in progress)
    { deal_name: "GreenLeaf - Supply Chain Tool",   lead_id: leadDocs[1]._id, assignedTo: u2._id, assignedBy: u1._id, stage: "P3", status: "open", dealValue: 120000, probability:  60, isActive: true,  is_deleted: false, expectedCloseDate: future(1), createdAt: past(1) },
    { deal_name: "Sunrise - POS System",            lead_id: leadDocs[3]._id, assignedTo: u3._id, assignedBy: u1._id, stage: "P2", status: "open", dealValue:  80000, probability:  40, isActive: true,  is_deleted: false, expectedCloseDate: future(2), createdAt: past(0) },
    { deal_name: "Vertex - Automation Suite",       lead_id: leadDocs[9]._id, assignedTo: u2._id, assignedBy: u1._id, stage: "P1", status: "open", dealValue:  90000, probability:  20, isActive: true,  is_deleted: false, expectedCloseDate: future(2), createdAt: past(0) },
    // Previous month won → shows in trend graph
    { deal_name: "Pinnacle - Phase 2 Add-on",       assignedTo: u2._id, assignedBy: u1._id, stage: "P7", status: "won",  dealValue: 200000, probability: 100, isActive: false, is_deleted: false, actualCloseDate: past(1), createdAt: past(2) },
    { deal_name: "TechNova - Support Contract",     assignedTo: u1._id, assignedBy: u1._id, stage: "P7", status: "won",  dealValue: 150000, probability: 100, isActive: false, is_deleted: false, actualCloseDate: past(2), createdAt: past(3) },
  ]);
  console.log("Deals inserted:", dealDocs.length);

  // ── FOLLOWUPS ──────────────────────────────────────────────────────────────
  const fups = [
    { title: "Initial call with TechNova",        leadId: leadDocs[0]._id, assignedTo: u1._id, kind: "followup", actionType: "call",    stage: "P1", scheduledAt: past(2),   completedAt: past(2),   status: "completed", notes: "Discussed ERP needs" },
    { title: "Demo for BlueSky team",             leadId: leadDocs[2]._id, assignedTo: u1._id, kind: "meeting",  actionType: "demo",    stage: "P2", scheduledAt: past(2),   completedAt: past(2),   status: "completed", notes: "Showed fleet dashboard" },
    { title: "Proposal sent to Pinnacle",         leadId: leadDocs[4]._id, assignedTo: u2._id, kind: "followup", actionType: "email",   stage: "P3", scheduledAt: past(3),   completedAt: past(3),   status: "completed", notes: "Sent proposal document" },
    { title: "GreenLeaf requirement gathering",   leadId: leadDocs[1]._id, assignedTo: u2._id, kind: "meeting",  actionType: "meeting", stage: "P2", scheduledAt: past(1),   completedAt: past(1),   status: "completed", notes: "Requirements noted" },
    { title: "Sunrise pricing discussion",        leadId: leadDocs[3]._id, assignedTo: u3._id, kind: "followup", actionType: "call",    stage: "P2", scheduledAt: past(1),   completedAt: past(1),   status: "completed", notes: "Negotiating pricing" },
    { title: "InnoTech CRM walkthrough",          leadId: leadDocs[6]._id, assignedTo: u3._id, kind: "meeting",  actionType: "demo",    stage: "P2", scheduledAt: past(1),   completedAt: past(1),   status: "completed", notes: "Live demo done" },
    { title: "Horizon contract discussion",       leadId: leadDocs[8]._id, assignedTo: u1._id, kind: "followup", actionType: "call",    stage: "P3", scheduledAt: past(2),   completedAt: past(2),   status: "completed", notes: "Contract terms finalised" },
    { title: "Vertex initial contact",            leadId: leadDocs[9]._id, assignedTo: u2._id, kind: "followup", actionType: "call",    stage: "P1", scheduledAt: past(0),   completedAt: null,      status: "pending",   notes: "Follow up on automation needs" },
    { title: "Coastal cold outreach",             leadId: leadDocs[5]._id, assignedTo: u4._id, kind: "followup", actionType: "email",   stage: "P1", scheduledAt: past(1),   completedAt: past(1),   status: "completed", notes: "No response" },
    { title: "Sigma final discussion",            leadId: leadDocs[7]._id, assignedTo: u4._id, kind: "followup", actionType: "call",    stage: "P3", scheduledAt: past(1),   completedAt: past(1),   status: "completed", notes: "Client declined" },
    // Upcoming followups
    { title: "GreenLeaf negotiation call",        leadId: leadDocs[1]._id, dealId: dealDocs[7]._id, assignedTo: u2._id, kind: "followup", actionType: "call",    stage: "P3", scheduledAt: future(0.25), status: "pending", notes: "Discuss final terms" },
    { title: "Sunrise POS demo followup",         leadId: leadDocs[3]._id, dealId: dealDocs[8]._id, assignedTo: u3._id, kind: "meeting",  actionType: "demo",    stage: "P2", scheduledAt: future(0.5),  status: "pending", notes: "Extended demo scheduled" },
    { title: "Vertex automation proposal",        leadId: leadDocs[9]._id, dealId: dealDocs[9]._id, assignedTo: u2._id, kind: "followup", actionType: "email",   stage: "P1", scheduledAt: future(1),    status: "pending", notes: "Send detailed proposal" },
    { title: "Coastal re-engagement",             leadId: leadDocs[5]._id, assignedTo: u4._id,      kind: "followup", actionType: "call",    stage: "P1", scheduledAt: future(1),    status: "pending", notes: "Try again next month" },
    { title: "Horizon Phase 2 discussion",        dealId: dealDocs[3]._id, assignedTo: u1._id,      kind: "meeting",  actionType: "meeting", stage: "P7", scheduledAt: future(2),    status: "pending", notes: "Upsell opportunity" },
  ];

  // add scheduledAt as Date where missing
  const followupDocs = await Followup.insertMany(
    fups.map(f => ({ ...f, scheduledAt: f.scheduledAt || new Date(), dueDateTime: f.scheduledAt || new Date() }))
  );
  console.log("Followups inserted:", followupDocs.length);

  console.log("\nSeed complete!");
  console.log(`Leads: ${leadDocs.length} | Deals: ${dealDocs.length} | Followups: ${followupDocs.length}`);
  process.exit(0);
}

seed().catch((err) => { console.error(err); process.exit(1); });
