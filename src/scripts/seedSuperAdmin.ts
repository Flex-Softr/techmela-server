import mongoose from "mongoose";
import config from "../app/config/config";
import { PERMISSIONS, permissionList } from "../app/const/permission.const";
import { Courier } from "../app/modules/courier/courier.model";
import { Address } from "../app/modules/userManagement/address/address.model";
import { Admin } from "../app/modules/userManagement/admin/admin.model";
import { TPermission } from "../app/modules/userManagement/permission/permission.interface";
import { Permission } from "../app/modules/userManagement/permission/permission.model";
import { ROLES } from "../app/modules/userManagement/user/user.const";
import { User } from "../app/modules/userManagement/user/user.model";
import { createAdminOrStaffId } from "../app/modules/userManagement/user/user.util";
import { consoleLogger } from "../app/utilities/logger";

const checkAndCreatePermissions = async (session: mongoose.ClientSession) => {
  const existingPermissions = await Permission.find({}, null, {
    session,
  }).lean();
  const existingNames = existingPermissions.map((p) => p.name);

  const permissionsToCreate = permissionList
    .filter((name) => !existingNames.includes(name))
    .map((name) => ({ name }));

  let createdPermissions: TPermission[] = [];
  if (permissionsToCreate.length > 0) {
    createdPermissions = await Permission.insertMany(permissionsToCreate, {
      session,
    });
    consoleLogger.info(
      `✅ Created missing permissions: ${permissionsToCreate.map((p) => p.name).join(", ")}`
    );
  }

  const allPermissions = [...existingPermissions, ...createdPermissions];
  const superAdminPermission = allPermissions.find(
    (p) => p.name === PERMISSIONS.SUPER_ADMIN
  );

  if (!superAdminPermission) {
    throw new Error(
      "❌ Super admin permission not found after creating permissions!"
    );
  }

  return superAdminPermission;
};

const createSuperAdmin = async () => {
  await Permission.init();
  await User.init();
  await Admin.init();
  await Address.init();

  await Admin.init();
  await Address.init();

  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const superAdminPermission = await checkAndCreatePermissions(session);

    // Double check inside transaction for race conditions (unlikely in seed script but good practice)
    const existingSuperAdmin = await User.findOne(
      { role: ROLES.SUPER_ADMIN },
      null,
      { session }
    );
    if (existingSuperAdmin) {
      if (!existingSuperAdmin.is_system) {
        await User.updateOne(
          { _id: existingSuperAdmin._id },
          { $set: { is_system: true } },
          { session }
        );
        consoleLogger.info("✅ Existing super admin marked as system user.");
      } else {
        consoleLogger.info("✅ Super admin already exists.");
      }
      await session.commitTransaction(); // Commit changes (like permissions) even if user exists
      return;
    }

    const userId = await createAdminOrStaffId(false);
    if (!userId) throw new Error("❌ Failed to create super admin user ID!");

    const seedEmail = config.superAdmin?.email;
    const seedPassword = config.superAdmin?.password;

    if (!seedEmail || !seedPassword) {
      throw new Error(
        "❌ SEED_EMAIL and SEED_PASSWORD are required in environment variables for seeding super admin!"
      );
    }

    const [[admin], [address]] = await Promise.all([
      Admin.create(
        [
          {
            uid: userId,
            fullName: "Super Admin",
          },
        ],
        { session }
      ),
      Address.create(
        [
          {
            uid: userId,
            fullAddress: "N/A",
          },
        ],
        { session }
      ),
    ]);

    await User.create(
      [
        {
          uid: userId,
          phoneNumber: "00000000000",
          email: seedEmail,
          password: seedPassword,
          role: ROLES.SUPER_ADMIN,
          admin: admin._id,
          address: address._id,
          permissions: [superAdminPermission._id],
          status: "active",
          is_system: true,
        },
      ],
      { session }
    );

    consoleLogger.info("✅ Super admin created successfully.");

    await session.commitTransaction(); // Commit only if success
  } catch (error) {
    await session.abortTransaction();
    consoleLogger.error(
      "❌ Transaction failed. Super admin creation aborted!",
      error
    );
    throw error;
  } finally {
    await session.endSession();
  }
};

const connectDB = async (): Promise<void> => {
  try {
    await mongoose.connect(config.DBUrl as string);
    consoleLogger.info("✅ Connected to MongoDB");
  } catch (error) {
    consoleLogger.error("❌ MongoDB connection failed:", error);
    process.exit(1);
  }
};

const seedCouriers = async () => {
  try {
    for (const provider of shippingMethodProviders) {
      const existingCourier = await Courier.findOne({ slug: provider.slug });
      if (!existingCourier) {
        await Courier.create({
          ...provider,
          isActive: false,
        });
        consoleLogger.info(`✅ Courier ${provider.name} created successfully.`);
      } else {
        consoleLogger.info(`ℹ️ Courier ${provider.name} already exists.`);
      }
    }
  } catch (error) {
    consoleLogger.error("❌ Error seeding couriers:", error);
    throw error;
  }
};

const seedSuperAdmin = async (): Promise<void> => {
  try {
    await connectDB();
    await createSuperAdmin();
    await seedCouriers();
    process.exit(0);
  } catch (error) {
    consoleLogger.error("❌ Error during super admin seeding:", error);
    process.exit(1);
  }
};

// eslint-disable-next-line no-undef
if (require.main === module) {
  // Only run if executed directly
  seedSuperAdmin();
}

const shippingMethodProviders = [
  {
    name: "Steadfast",
    slug: "steadfast",
    credentials: [
      { key: "Api-Key", value: "" },
      { key: "Secret-Key", value: "" },
    ],
  },
  {
    name: "Pathao",
    slug: "pathao",
    credentials: [
      { key: "client_id", value: "" },
      { key: "client_secret", value: "" },
      { key: "username", value: "" },
      { key: "password", value: "", need_to_hash: true },
      { key: "access_token", value: "", is_optional: true },
      { key: "access_token_expires_in", value: "", is_optional: true },
    ],
  },
  {
    name: "Redx",
    slug: "redx",
    credentials: [{ key: "API-ACCESS-TOKEN", value: "" }],
  },
  {
    name: "Paperfly",
    slug: "paperfly",
    credentials: [
      { key: "username", value: "" },
      { key: "password", value: "", need_to_hash: false },
      { key: "paperflykey", value: "" },
    ],
  },
];

export default seedSuperAdmin;
