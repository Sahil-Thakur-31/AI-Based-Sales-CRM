//Converts range=week|month|quarter into date windows for queries.

// backend/services/dashboardRange.admin.js
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function getRangeDates(range = "month") {
  const now = new Date();

  let days = 30;
  if (range === "week") days = 7;
  if (range === "quarter") days = 90;

  const end = endOfDay(now);
  const start = startOfDay(new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000));

  // previous same-length period (for delta calculations)
  const prevEnd = endOfDay(new Date(start.getTime() - 1));
  const prevStart = startOfDay(new Date(prevEnd.getTime() - (days - 1) * 24 * 60 * 60 * 1000));

  return { start, end, prevStart, prevEnd, days };
}

module.exports = { getRangeDates };