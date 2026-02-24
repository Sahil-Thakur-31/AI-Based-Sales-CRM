const Expense = require("../models/expenses");
const getNextCounter = require("../utils/getNextCounter");

exports.createExpense = async (req, res) => {
  try {
    const expenseNo = await getNextCounter("EXPENSE");

    const expense = await Expense.create({
      ...req.body,
      expenseNo,
    });

    res.status(201).json(expense);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.getExpenses = async (req, res) => {
  try {
    const expenses = await Expense.find({ is_deleted: false })
      .populate("userId", "name email")
      .sort({ expenseDate: -1 });

    res.json(expenses);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.deleteExpense = async (req, res) => {
  try {
    await Expense.findByIdAndUpdate(req.params.id, {
      is_deleted: true,
    });

    res.json({ message: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};