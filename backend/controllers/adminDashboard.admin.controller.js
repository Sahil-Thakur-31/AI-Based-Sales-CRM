//Purpose: Controller layer for API endpoints (calls the service functions).


const svc = require("../services/adminDashboardService");

exports.summary = async (req, res) => {
  const range = req.query.range || "month";
  const data = await svc.getSummary(range);
  res.json(data);
};

exports.pipeline = async (req, res) => {
  const range = req.query.range || "month";
  const data = await svc.getPipeline(range);
  res.json(data);
};

exports.teamPerformance = async (req, res) => {
  const range = req.query.range || "month";
  const data = await svc.getTeamPerformance(range);
  res.json(data);
};

exports.followups = async (req, res) => {
  const range = req.query.range || "month";
  const data = await svc.getFollowups(range, req.user?._id);
  res.json(data);
};

exports.recentDeals = async (req, res) => {
  const range = req.query.range || "month";
  const data = await svc.getRecentDeals(range);
  res.json(data);
};
