const Team = require('../models/teams');
const Deal = require('../models/deals');
const Lead = require('../models/leads');
const Expense = require('../models/expenses');
const User = require('../models/users');
const mongoose = require('mongoose');

// create a new team (admin only). admin must specify a manager who will lead
exports.createTeam = async (req, res) => {
  const { members, name, teamLeadIds } = req.body;
  const userId = req.user && req.user._id;
  const role = req.user && req.user.role;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });
  if (role !== 'Admin') return res.status(403).json({ message: 'Only admins can create teams' });
  if (!Array.isArray(teamLeadIds) || teamLeadIds.length === 0) return res.status(400).json({ message: 'teamLeadIds required' });
  const team = new Team({ teamLeads: teamLeadIds.map(id=>({userId:id})), members: [], createdBy: userId });
  if (name) team.name = name;
  if (Array.isArray(members)) {
    team.members = members.map(id => ({ userId: id }));
  }
  await team.save();
  res.json(team);
};

// list teams for current user (managers see only ones they lead, admins see all)
exports.listTeams = async (req, res) => {
  const userId = req.user && req.user._id;
  const role = req.user && req.user.role;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });
  let teams;
  if (role === 'Admin') {
    teams = await Team.find()
      .populate('teamLeads.userId', 'name email')
      .populate('members.userId', 'name email role');
  } else if (role === 'Manager') {
    teams = await Team.find({ 'teamLeads.userId': userId })
      .populate('teamLeads.userId', 'name email')
      .populate('members.userId', 'name email');
  } else {
    return res.status(403).json({ message: 'Access denied' });
  }
  res.json(teams);
};

// add member to a specific team
exports.addMember = async (req, res) => {
  const userId = req.user && req.user._id;
  const role = req.user && req.user.role;
  const { userId: newMemberId, teamId } = req.body;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });
  if (role !== 'Manager' && role !== 'Admin') return res.status(403).json({ message: 'Only managers/admins can modify teams' });
  if (!newMemberId) return res.status(400).json({ message: 'Missing userId' });
  if (!teamId) return res.status(400).json({ message: 'Missing teamId' });
  let team;
  if (role === 'Admin') {
    team = await Team.findById(teamId);
  } else {
    team = await Team.findOne({ _id: teamId, 'teamLead.userId': userId });
  }
  if (!team) return res.status(404).json({ message: 'Team not found' });
  if (team.members.some(m => String(m.userId) === String(newMemberId))) {
    return res.status(400).json({ message: 'Member already in team' });
  }
  team.members.push({ userId: newMemberId });
  await team.save();
  res.json(team);
};

// remove member from specific team
exports.removeMember = async (req, res) => {
  const userId = req.user && req.user._id;
  const role = req.user && req.user.role;
  const { userId: removeId, teamId } = req.body;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });
  if (role !== 'Manager' && role !== 'Admin') return res.status(403).json({ message: 'Only managers/admins can modify teams' });
  if (!removeId) return res.status(400).json({ message: 'Missing userId' });
  if (!teamId) return res.status(400).json({ message: 'Missing teamId' });
  let team;
  if (role === 'Admin') {
    team = await Team.findById(teamId);
  } else {
    team = await Team.findOne({ _id: teamId, 'teamLead.userId': userId });
  }
  if (!team) return res.status(404).json({ message: 'Team not found' });
  team.members = team.members.filter(m => String(m.userId) !== String(removeId));
  await team.save();
  res.json(team);
};

// dashboard stats for team
exports.getTeamDashboard = async (req, res) => {
  const userId = req.user && req.user._id;
  const role = req.user && req.user.role;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });
  const { teamId } = req.query;
  let team;
  if (role === 'Admin') {
    if (teamId) team = await Team.findById(teamId).populate('members.userId', 'name email role');
    else return res.status(400).json({ message: 'teamId required' });
  } else if (role === 'Manager') {
    if (teamId) {
      team = await Team.findOne({ _id: teamId, 'teamLead.userId': userId }).populate('members.userId', 'name email role');
    } else {
      // fallback to first team
      team = await Team.findOne({ 'teamLead.userId': userId }).populate('members.userId', 'name email role');
    }
  } else {
    return res.status(403).json({ message: 'Only managers can view team dashboard' });
  }
  if (!team) return res.status(404).json({ message: 'Team not found' });
  const memberIds = team.members.map(m => m.userId);
  // include all team leads as well
  if (team.teamLeads && team.teamLeads.length) {
    team.teamLeads.forEach(l => {
      if (l.userId) memberIds.push(l.userId);
    });
  }
  // stats: count todays followups (assuming leads with last_contact_date today)
  const today = new Date();
  today.setHours(0,0,0,0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate()+1);
  const followupsCount = await Lead.countDocuments({
    assigned_to: { $in: memberIds },
    last_contact_date: { $gte: today, $lt: tomorrow },
    is_deleted: {$ne: true}
  });
  const dealsCount = await Deal.countDocuments({
    assignedTo: { $in: memberIds },
    status: { $ne: 'lost' },
    is_deleted: {$ne: true}
  });
  const pipelineValueAgg = await Deal.aggregate([
    { $match: { assignedTo: { $in: memberIds }, status: { $ne: 'lost' }, is_deleted: {$ne: true} } },
    { $group: { _id: null, total: { $sum: '$dealValue' } } }
  ]);
  const pipelineValue = pipelineValueAgg.length ? pipelineValueAgg[0].total : 0;
  // win rate = won deals / total closed (won+lost)
  const closedAgg = await Deal.aggregate([
    { $match: { assignedTo: { $in: memberIds }, status: { $in: ['won','lost'] }, is_deleted: {$ne: true} } },
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);
  let won=0,lost=0;
  closedAgg.forEach(r => { if(r._id==='won') won=r.count; if(r._id==='lost') lost=r.count; });
  const winRate = won + lost > 0 ? Math.round((won/(won+lost))*100) : 0;
  // list followups details sample
  const followups = await Lead.find({ assigned_to: { $in: memberIds }, is_deleted: {$ne: true} })
    .limit(5)
    .select('company_name message last_contact_date');
  const insights = [];
  res.json({
    teamLeads: team.teamLeads,
    members: team.members,
    stats: [
      { title: "Today's Follow-ups", value: followupsCount, sub: '', icon: "📞", color: "blue" },
      { title: "Active Deals", value: dealsCount, sub: '', icon: "💼", color: "green" },
      { title: "Pipeline Value", value: pipelineValue, sub: '', icon: "📈", color: "orange" },
      { title: "Win Rate", value: winRate + '%', sub: '', icon: "⭐", color: "purple" }
    ],
    pipelineValue,
    followups,
    insights
  });
};