const Role = require("../models/roles");

const DEFAULT_ROLES = [
  { name: "Admin", description: "Full system access" },
  { name: "Manager", description: "Team and operational access" },
  { name: "User", description: "Standard user access" }
];

async function ensureDefaultRoles() {
  const now = new Date();

  for (const role of DEFAULT_ROLES) {
    await Role.updateOne(
      { name: { $regex: `^${role.name}$`, $options: "i" } },
      {
        $set: {
          name: role.name,
          description: role.description,
          is_deleted: false,
          updatedAt: now
        },
        $setOnInsert: {
          createdAt: now
        }
      },
      { upsert: true }
    );
  }

  console.log("default roles ensured");
}

module.exports = { ensureDefaultRoles };
