const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const connectDatabase = require("./config/db");
const { ensureDefaultRoles } = require("./services/defaultRolesSeeder");
const { createUser } = require("./controllers/userController");

const ADMIN_EMAIL = "Sahilthakur3109@gmail.com";

function createMockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

async function seedAdminUser() {
  await connectDatabase();
  await ensureDefaultRoles();

  const req = {
    body: {
      name: "Sahil Thakur",
      email: ADMIN_EMAIL,
      role: "Admin"
    },
    user: null
  };
  const res = createMockResponse();

  await createUser(req, res);

  if (res.statusCode >= 400) {
    throw new Error(res.body?.message || "Admin user seed failed");
  }

  console.log(`Admin user ensured: ${ADMIN_EMAIL}`);
  console.log("Default password:", process.env.DEFAULT_NEW_USER_PASSWORD || "Adcs@1234");
}

seedAdminUser()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
