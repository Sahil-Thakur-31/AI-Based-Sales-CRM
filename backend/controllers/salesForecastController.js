const { getSalesForecast } = require("../services/salesForecastService");

exports.getForecast = async (req, res) => {
  try {
    const payload = await getSalesForecast(req.user || {}, {
      range: req.query?.range,
    });
    res.json(payload);
  } catch (error) {
    console.error("salesForecast.getForecast error:", error);
    res.status(500).json({
      message: "Failed to generate sales forecast from the trained model.",
    });
  }
};
