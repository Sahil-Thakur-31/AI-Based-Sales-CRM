const express = require('express');
const router = express.Router();
const teamsController = require('../controllers/teamsController');
const auth = require('../middlewares/auth');

// all routes require authentication
router.post('/', auth, teamsController.createTeam);
router.put('/:teamId', auth, teamsController.updateTeam);
router.delete('/:teamId', auth, teamsController.deleteTeam);
router.get('/', auth, teamsController.listTeams);  // return teams for manager or all for admin
router.get('/me', auth, teamsController.listTeams); // alias
router.post('/add-member', auth, teamsController.addMember);
router.post('/remove-member', auth, teamsController.removeMember);
router.get('/dashboard', auth, teamsController.getTeamDashboard);

module.exports = router;
