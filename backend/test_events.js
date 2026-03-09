require('dotenv').config();
const mongoose = require('mongoose');
mongoose.connect(process.env.CONN).then(async () => {
    const Followup = require('./models/followUp.js');
    const evs = await Followup.find({
        kind: { $in: ['meeting', 'followup'] },
        is_deleted: { $ne: true },
        status: { $ne: 'cancelled' }
    }).lean();
    console.log('Total valid meeting/followups:', evs.length);
    const mar6 = evs.filter(e => e.dueDateTime && new Date(e.dueDateTime).toISOString().startsWith('2026-03-06'));
    console.log('Events on Mar 6 UTC:');
    mar6.forEach(e => {
        console.log(`- ${e.title} @ ${new Date(e.dueDateTime).toISOString()} (id: ${e._id}, type: ${e.actionType})`);
    });

    const mar7 = evs.filter(e => e.dueDateTime && new Date(e.dueDateTime).toISOString().startsWith('2026-03-07'));
    console.log('\nEvents on Mar 7 UTC:');
    mar7.forEach(e => {
        console.log(`- ${e.title} @ ${new Date(e.dueDateTime).toISOString()} (id: ${e._id}, type: ${e.actionType})`);
    });
    process.exit(0);
});
