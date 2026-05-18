const Industry = require("../models/industries");
const { cleanIndustryName, findIndustryByCanonicalName } = require("../utils/industryCatalog");


/* GET ALL INDUSTRIES (exclude deleted) */
exports.getIndustries = async (req, res) => {

  try {

    const status = String(req.query?.status || "active").trim().toLowerCase();
    const filter = {};

    if (status === "deleted") {
      filter.is_deleted = true;
    }
    else if (status !== "all") {
      filter.is_deleted = false;
    }

    const data = await Industry.find({
      ...filter
    })
    .sort({ is_deleted: 1, name: 1 })
    .lean();

    const seen = new Set();
    const deduped = [];

    for (const item of data) {
      const canonicalName = cleanIndustryName(item?.name || "");
      const key = canonicalName.toLowerCase();
      if (!canonicalName || seen.has(key)) continue;
      seen.add(key);
      deduped.push({
        ...item,
        name: canonicalName,
      });
    }

    res.json(deduped);

  }
  catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Failed to fetch industries"
    });

  }

};


/* CREATE INDUSTRY */
exports.createIndustry = async (req, res) => {

  try {

    const canonicalName = cleanIndustryName(req.body.name);
    if (!canonicalName) {
      return res.status(400).json({ message: "Industry name is required" });
    }

    const existing = await findIndustryByCanonicalName(canonicalName, { includeDeleted: true });
    if (existing) {
      let changed = false;
      if (existing.name !== canonicalName) {
        existing.name = canonicalName;
        changed = true;
      }
      if (existing.is_deleted) {
        existing.is_deleted = false;
        changed = true;
      }
      if (req.body.description !== undefined) {
        existing.description = req.body.description;
        changed = true;
      }
      if (req.body.code !== undefined) {
        existing.code = req.body.code;
        changed = true;
      }
      if (changed) {
        existing.updatedAt = new Date();
        await existing.save();
      }
      return res.json(existing);
    }

    const industry = await Industry.create({
      name: canonicalName,
      description: req.body.description,
      code: req.body.code,
      createdAt: new Date(),
      updatedAt: new Date(),
      is_deleted: false
    });

    res.json(industry);

  }
  catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Failed to create industry"
    });

  }

};


/* UPDATE INDUSTRY */
exports.updateIndustry = async (req, res) => {

  try {

    const canonicalName = cleanIndustryName(req.body.name);
    if (!canonicalName) {
      return res.status(400).json({ message: "Industry name is required" });
    }

    const duplicate = await findIndustryByCanonicalName(canonicalName, {
      includeDeleted: true,
      excludeId: req.params.id,
    });
    if (duplicate) {
      return res.status(400).json({ message: "Industry already exists" });
    }

    const industry = await Industry.findByIdAndUpdate(
      req.params.id,
      {
        name: canonicalName,
        description: req.body.description,
        code: req.body.code,
        updatedAt: new Date()
      },
      { returnDocument: "after" }
    );

    res.json(industry);

  }
  catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Failed to update industry"
    });

  }

};


/* SOFT DELETE INDUSTRY */
exports.deleteIndustry = async (req, res) => {

  try {

    await Industry.findByIdAndUpdate(

      req.params.id,

      {

        is_deleted: true,

        updatedAt: new Date()

      }

    );

    res.json({

      message: "Industry deleted successfully"

    });

  }
  catch (err) {

    console.error(err);

    res.status(500).json({

      message: "Delete failed"

    });

  }

};


/* RESTORE INDUSTRY (optional but recommended) */
exports.activateIndustry = async (req, res) => {

  try {

    await Industry.findByIdAndUpdate(

      req.params.id,

      {

        is_deleted: false,

        updatedAt: new Date()

      }

    );

    res.json({

      message: "Industry restored successfully"

    });

  }
  catch (err) {

    console.error(err);

    res.status(500).json({

      message: "Restore failed"

    });

  }

};
