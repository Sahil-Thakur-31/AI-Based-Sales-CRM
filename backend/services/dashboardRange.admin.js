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

function addDays(d, days) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function startOfWeek(d) {
  const x = startOfDay(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function endOfWeek(d) {
  return endOfDay(addDays(startOfWeek(d), 6));
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d) {
  return endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

function startOfQuarter(d) {
  const month = d.getMonth();
  const quarterStartMonth = month - (month % 3);
  return new Date(d.getFullYear(), quarterStartMonth, 1);
}

function endOfQuarter(d) {
  const start = startOfQuarter(d);
  return endOfDay(new Date(start.getFullYear(), start.getMonth() + 3, 0));
}

function getRangeDates(range = "month") {
  const now = new Date();
  let start;
  let end;
  let prevStart;
  let prevEnd;

  if (range === "week") {
    start = startOfWeek(now);
    end = endOfWeek(now);
    prevStart = addDays(start, -7);
    prevEnd = endOfDay(addDays(start, -1));
  } else if (range === "quarter") {
    start = startOfQuarter(now);
    end = endOfQuarter(now);
    const prevQuarterDate = new Date(start.getFullYear(), start.getMonth() - 3, 1);
    prevStart = startOfQuarter(prevQuarterDate);
    prevEnd = endOfQuarter(prevQuarterDate);
  } else {
    start = startOfMonth(now);
    end = endOfMonth(now);
    const prevMonthDate = new Date(start.getFullYear(), start.getMonth() - 1, 1);
    prevStart = startOfMonth(prevMonthDate);
    prevEnd = endOfMonth(prevMonthDate);
  }

  const days = Math.max(1, Math.round((endOfDay(end).getTime() - startOfDay(start).getTime()) / (24 * 60 * 60 * 1000)) + 1);
  return { start: startOfDay(start), end: endOfDay(end), prevStart: startOfDay(prevStart), prevEnd: endOfDay(prevEnd), days };
}

module.exports = { getRangeDates };
