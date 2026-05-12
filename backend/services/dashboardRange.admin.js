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

function startOfYear(d) {
  return new Date(d.getFullYear(), 0, 1);
}

function endOfYear(d) {
  return endOfDay(new Date(d.getFullYear(), 11, 31));
}

function getRangeDates(range = "month") {
  const now = new Date();
  const normalizedRange = String(range || "month").toLowerCase();
  let start;
  let end;
  let prevStart;
  let prevEnd;

  if (normalizedRange === "today" || normalizedRange === "day") {
    start = startOfDay(now);
    end = endOfDay(now);
    prevStart = startOfDay(addDays(start, -1));
    prevEnd = endOfDay(addDays(start, -1));
  } else if (normalizedRange === "week") {
    start = startOfWeek(now);
    end = endOfWeek(now);
    prevStart = addDays(start, -7);
    prevEnd = endOfDay(addDays(start, -1));
  } else if (normalizedRange === "quarter") {
    start = startOfQuarter(now);
    end = endOfQuarter(now);
    const prevQuarterDate = new Date(start.getFullYear(), start.getMonth() - 3, 1);
    prevStart = startOfQuarter(prevQuarterDate);
    prevEnd = endOfQuarter(prevQuarterDate);
  } else if (normalizedRange === "year") {
    start = startOfYear(now);
    end = endOfYear(now);
    const prevYearDate = new Date(start.getFullYear() - 1, 0, 1);
    prevStart = startOfYear(prevYearDate);
    prevEnd = endOfYear(prevYearDate);
  } else if (normalizedRange === "lifetime" || normalizedRange === "all") {
    start = new Date(0);
    end = endOfDay(now);
    prevStart = new Date(0);
    prevEnd = new Date(0);
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
