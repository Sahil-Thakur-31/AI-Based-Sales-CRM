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

function normalizeMonth(month, fallbackMonth) {
  const numericMonth = Number(month);
  if (!Number.isInteger(numericMonth)) return fallbackMonth;
  if (numericMonth >= 1 && numericMonth <= 12) return numericMonth - 1;
  if (numericMonth >= 0 && numericMonth <= 11) return numericMonth;
  return fallbackMonth;
}

function normalizeYear(year, fallbackYear) {
  const numericYear = Number(year);
  if (!Number.isInteger(numericYear)) return fallbackYear;
  if (numericYear < 2000 || numericYear > 2100) return fallbackYear;
  return numericYear;
}

function normalizeQuarter(quarter, fallbackQuarter = "q1") {
  const value = String(quarter || fallbackQuarter).toLowerCase();
  return ["q1", "q2", "q3", "q4"].includes(value) ? value : fallbackQuarter;
}

function quarterStartMonthFromValue(quarter) {
  if (quarter === "q2") return 3;
  if (quarter === "q3") return 6;
  if (quarter === "q4") return 9;
  return 0;
}

function getRangeDates(range = "month", options = {}) {
  const now = options.now instanceof Date ? new Date(options.now) : new Date();
  const period = String(options.period || "").toLowerCase();
  const normalizedRange = period === "quarterly"
    ? "quarter"
    : period === "yearly"
      ? "year"
      : String(range || "month").toLowerCase();
  const selectedMonth = normalizeMonth(options.month, now.getMonth());
  const selectedYear = normalizeYear(options.year, now.getFullYear());
  const selectedQuarter = normalizeQuarter(options.quarter, `q${Math.floor(now.getMonth() / 3) + 1}`);
  const selectedMonthDate = new Date(selectedYear, selectedMonth, 1);
  const selectedQuarterDate = new Date(selectedYear, quarterStartMonthFromValue(selectedQuarter), 1);
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
    start = startOfQuarter(selectedQuarterDate);
    end = endOfQuarter(selectedQuarterDate);
    const prevQuarterDate = new Date(start.getFullYear(), start.getMonth() - 3, 1);
    prevStart = startOfQuarter(prevQuarterDate);
    prevEnd = endOfQuarter(prevQuarterDate);
  } else if (normalizedRange === "year") {
    const selectedYearDate = new Date(selectedYear, 0, 1);
    start = startOfYear(selectedYearDate);
    end = endOfYear(selectedYearDate);
    const prevYearDate = new Date(start.getFullYear() - 1, 0, 1);
    prevStart = startOfYear(prevYearDate);
    prevEnd = endOfYear(prevYearDate);
  } else if (normalizedRange === "lifetime" || normalizedRange === "all") {
    start = new Date(0);
    end = endOfDay(now);
    prevStart = new Date(0);
    prevEnd = new Date(0);
  } else {
    start = startOfMonth(selectedMonthDate);
    end = endOfMonth(selectedMonthDate);
    const prevMonthDate = new Date(start.getFullYear(), start.getMonth() - 1, 1);
    prevStart = startOfMonth(prevMonthDate);
    prevEnd = endOfMonth(prevMonthDate);
  }

  const days = Math.max(1, Math.round((endOfDay(end).getTime() - startOfDay(start).getTime()) / (24 * 60 * 60 * 1000)) + 1);
  return { start: startOfDay(start), end: endOfDay(end), prevStart: startOfDay(prevStart), prevEnd: endOfDay(prevEnd), days };
}

module.exports = { getRangeDates };
