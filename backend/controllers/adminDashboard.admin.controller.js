//Purpose: Controller layer for API endpoints (calls the service functions).


const svc = require("../services/adminDashboardService");

function getFilters(query = {}) {
  return {
    period: query.period,
    range: query.range || "month",
    month: query.month,
    quarter: query.quarter,
    year: query.year
  };
}

exports.summary = async (req, res) => {
  const data = await svc.getSummary(getFilters(req.query));
  res.json(data);
};

exports.pipeline = async (req, res) => {
  const filters = getFilters(req.query);
  const pipelineType = String(req.query.pipelineType || req.query.type || "deal").toLowerCase();
  const data = await svc.getPipeline(filters, pipelineType);
  res.json(data);
};

exports.teamPerformance = async (req, res) => {
  const data = await svc.getTeamPerformance(getFilters(req.query));
  res.json(data);
};

exports.followups = async (req, res) => {
  const data = await svc.getFollowups(getFilters(req.query), req.user?._id);
  res.json(data);
};

exports.recentDeals = async (req, res) => {
  const data = await svc.getRecentDeals(getFilters(req.query));
  res.json(data);
};
